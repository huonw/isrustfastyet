#![feature(slice_patterns, rustc_private, result_expect, path_ext)]
//! Converts the raw mem.json (etc) to a more useable form.

extern crate serialize as rustc_serialize;
use rustc_serialize::{json, Decodable, Encodable};
use std::thread;
use std::io::{Read, Write};
use std::fs::{self, File, PathExt};
use std::collections::HashSet;
use std::path::Path;
use std::cmp::Ordering::*;

mod line_simplify;

trait Expect<T> { fn expect(self, String) -> T; }
impl<T, U> Expect<T> for Result<T, U> {
    fn expect(self, s: String) -> T {
        match self {
            Ok(a) => a,
            Err(_) => panic!(s)
        }
    }
}

// these reflect the structure of mem.json exactly

#[derive(RustcDecodable)]
#[allow(dead_code)]
struct CPUAcct {
    hz: f64,
    usage: u32,
    user: f64,
    system: f64
}

#[derive(RustcDecodable)]
#[allow(dead_code)]
struct Data {
    cli: Option<String>,
    stdout: String,
    stderr: String,
    elapsed: f64,
    cpuacct: CPUAcct,
    max_memory: u32,
    memory_data: Vec<(f64, f64)>,
}

// these form the format we wish to output.
#[derive(RustcEncodable)]
struct Output {
    summary: Summary,
    memory_data: Vec<(f64, f64)>,
    pass_timing: Vec<(String, f64)>,
}

#[derive(RustcEncodable, RustcDecodable, Clone, PartialOrd, PartialEq)]
struct Summary {
    timestamp: u32,
    hash: String,
    max_memory: f64,
    cpu_time: Option<f64>,
    pull_request: Option<u32>
}

// The list of all hashes that we know about.
fn processing_possibilities() -> HashSet<String> {
    fs::read_dir(&Path::new("data/data"))
        .expect("couldn't read data/data")
        .into_iter()
        .map(|hash| hash.unwrap().file_name().into_string().unwrap())
        .filter(|hash| "history.txt" != hash)
        .collect()
}

// Read the current summary json file, or "make" a new one if it
// doesn't work.
fn load_summary(p: &Path) -> Vec<Summary> {
    match File::open(p).map(|mut rdr| {
        json::from_reader(&mut rdr).expect("summary is invalid")
    }) {
        Err(_) => vec![],
        Ok(json) =>  Decodable::decode(&mut json::Decoder::new(json)).unwrap()
    }
}

/// A list of commits we've already seen
fn already_processed(summary: &[Summary]) -> Vec<String> {
    summary.iter().map(|x| x.hash.clone()).collect()
}

/// Reduce the number of points, while (hopefully) maintaining a
/// decent representation of the data
fn simplify_memory_data(v: &[(f64, f64)]) -> Vec<(f64, f64)> {
    //line_simplify::rdp(v, 0.001)
    line_simplify::visvalingam(v, 100000.0)
}

/// A parser for the output of GNU time
fn extract_time(time_str: &str) -> (f64, f64) {
    // we fail here because we assume that time.txt existing => it
    // should be valid. Ignoring time.txt requires removing it.
    let i = time_str.find("user ").expect("time is formatted wrong: missing user");
    let j = time_str.find("system ").expect("time is formatted wrong: missing system");
    // reading directly as f64 doesn't work on some computers! :(
    let user = time_str[..i].parse()
        .expect("time is formatted wrong: user not a f64");
    let system = time_str[i + 5 .. j].parse()
        .expect("time is formatted wrong: system not a f64");
    (user, system)
}

/// A parser for the time-passes output of rustc.
pub fn pass_timing(s: &str) -> Vec<(String, f64)> {
    let mut last_indent = 0;
    let mut subindent_count = 0;
    s.lines().filter_map(|l| {
        if l.is_empty() {
            None
        } else {
            let indent = l.find(|c: char| c != ' ').expect("a line that's all ' '?");
            let time_start = &l[indent + 6..];
            let i = time_start.find(' ').expect(&format!("invalid pass timing info (1): {}", l));

            let raw_time = time_start[..i].parse()
                    .expect(&format!("invalid pass timing info (2): {}", l));

            let i = time_start.find('\t')
                .expect(&format!("invalid pass timing info (3): {}", l));
            let time = if indent < last_indent {
                // we just came out of a subsection so mark this as
                // such with a tiny negative time(!) the "total"
                // heading. FIXME: read and display this properly.
                let t = -1e-10 * (subindent_count as f64);
                subindent_count = 1;
                t
            } else {
                subindent_count += 1;
                raw_time
            };
            last_indent = indent;
            Some((time_start[i+1..].to_string(), time))
        }
    }).collect()
}

fn main() {
    let summary_path = Path::new("out/summary.json");
    let mut summary = load_summary(&summary_path);

    // work out what we're going to process
    let mut to_process = processing_possibilities();
    for hash in already_processed(&summary).into_iter() {
        to_process.remove(&hash);
    }

    // necessary in case the subtask fails
    let mut results = Vec::with_capacity(to_process.len());

    for hash in to_process.into_iter() {
        println!("{}", hash);

        // parallelism!
        results.push(thread::spawn(move || {
            // as_slice, to avoid moving out of it because a proc bug
            // allows that.
            let hash_folder = Path::new("data/data").join(&hash);
            if !hash_folder.is_dir() {
                println!("{} doesn't exist; skipping.", hash);
		None
            } else {
                let mem_path = hash_folder.join("mem.json");
                let time_path = hash_folder.join("time.txt");
                let ci_path = hash_folder.join("commit_info.txt");

                let time_file = File::open(&time_path);
                let time = time_file.map(|mut file| {
                    let mut raw_time = String::new();
                    file.read_to_string(&mut raw_time).expect("Couldn't read time.txt");
                    let (user, system) = extract_time(&raw_time);
                    user + system
                });
                let time = match time { Ok(o) => Some(o), Err(_) => None };

                let mut ci_file = File::open(&ci_path)
                    .expect(&format!("no {}/commit_info.txt", hash));
                let mut raw_commit_info = String::new();
                ci_file.read_to_string(&mut raw_commit_info).expect("couldn't read commit_info.txt");
                let mut lines = raw_commit_info.lines();
                let (author, timestamp, summary) = match (lines.next(),
                                                          lines.next().and_then(|s| s.parse().ok()),
                                                          lines.next()) {
                    (Some(a), Some(b), Some(c)) => (a, b, c),
                    _ => panic!("invalid {}/commit_info.txt", hash)
                };

                let pull_request = if author == "bors bors@rust-lang.org" {
                    let i = summary.find('#').expect("Bors merge without a number?") + 1;
                    // a bors commit, so extract the pull request
                    let leading_num = &summary[i..];
                    let non_num = leading_num.find(|c: char| !c.is_digit(10)).unwrap_or(0);
                    leading_num[..non_num].parse().ok()
                } else {
                    None
                };

                // load the mem.json file.
                let json = File::open(&mem_path).map(|mut rdr| {
                    json::from_reader(&mut rdr)
                            .expect(&format!("{}/mem.json is not json", hash))
                }).expect(&format!("no {}/mem.json", hash));

                let d: Data = Decodable::decode(&mut json::Decoder::new(json)).unwrap();
                let simple_mem = simplify_memory_data(&d.memory_data);

                // if stdout is empty, this should just return nothing
                let pass_timing = pass_timing(&d.stdout);

                // create & write the output
                let summary = Summary {
                    hash: hash.clone(),
                    timestamp: timestamp,
                    cpu_time: time,
                    max_memory: d.max_memory as f64,
                    pull_request: pull_request
                };
                let out = Output {
                    memory_data: simple_mem,
                    pass_timing: pass_timing,
                    summary: summary.clone()
                };

                let fname = Path::new("out").join(hash + ".json");
                let mut out_f = File::create(&fname)
                    .expect(&format!("{} can't be opened", fname.display()));
                let encoded = json::encode(&out).unwrap();
                out_f.write_all(encoded.as_bytes()).unwrap();
                Some(summary)
            }
        }));
    }

    // collect the summaries
    for r in results.into_iter() {
	if let Some(sum) = r.join().unwrap() {
            summary.push(sum);
        }
    }

    summary.sort_by(|x, y| if *x < *y {Less} else if *x == *y {Equal} else {Greater});

    let mut text = String::new();
    summary.encode(&mut json::Encoder::new(&mut text)).unwrap();

    let mut summary_f = File::create(&summary_path).expect("can't write to summary");
    // put one commit a line, so the diffs are smaller.
    summary_f.write(text.replace("{", "\n{").replace("]", "\n]").as_bytes()).unwrap();
}
