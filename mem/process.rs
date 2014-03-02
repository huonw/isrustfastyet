//! Converts the raw mem.json (etc) to a more useable form.

extern mod extra;
use extra::{json};
use extra::serialize::{Decodable, Encodable};
use std::{io, comm, str, vec, task};
use std::io::{fs, File};
use std::hashmap::HashSet;
use std::option::IntoOption;

mod line_simplify;

trait Expect<T> { fn expect(self, ~str) -> T; }
impl<T, U> Expect<T> for Result<T, U> {
    fn expect(self, s: ~str) -> T {
        match self {
            Ok(a) => a,
            Err(_) => fail!(s)
        }
    }
}

// these reflect the structure of mem.json exactly

#[deriving(Decodable)]
struct CPUAcct {
    hz: f64,
    usage: uint,
    user: f64,
    system: f64
}

#[deriving(Decodable)]
struct Data {
    cli: ~str,
    stdout: ~str,
    stderr: ~str,
    elapsed: f64,
    cpuacct: CPUAcct,
    max_memory: uint,
    memory_data: ~[(f64, f64)],
}

// these form the format we wish to output.
#[deriving(Encodable)]
struct Output {
    summary: Summary,
    memory_data: ~[(f64, f64)],
    pass_timing: ~[(~str, f64)]
}

#[deriving(Encodable, Decodable, Clone, Ord)]
struct Summary {
    timestamp: uint,
    hash: ~str,
    max_memory: f64,
    cpu_time: Option<f64>,
    pull_request: Option<uint>
}

// The list of all hashes that we know about.
fn processing_possibilities() -> HashSet<~str> {
    fs::readdir(&Path::new("data/data")).move_iter()
        .filter_map(|hash| hash.filename_str().map(|s| s.to_owned()))
        .filter(|hash| "history.txt" != *hash)
        .collect()
}

// Read the current summary json file, or "make" a new one if it
// doesn't work.
fn load_summary(p: &Path) -> ~[Summary] {
    match io::result(|| File::open(p).map(|mut rdr| {
        json::from_reader(&mut rdr as &mut Reader).expect(~"summary is invalid")
    })) {
        Err(_) | Ok(None) => ~[],
        Ok(Some(json)) =>  Decodable::decode(&mut json::Decoder::new(json))
    }
}

/// A list of commits we've already seen
fn already_processed(summary: &[Summary]) -> ~[~str] {
    summary.iter().map(|x| x.hash.to_owned()).collect()
}

/// Reduce the number of points, while (hopefully) maintaining a
/// decent representation of the data
fn simplify_memory_data(v: &[(f64, f64)]) -> ~[(f64, f64)] {
    //line_simplify::rdp(v, 0.001)
    line_simplify::visvalingam(v, 100000.0)
}

/// A parser for the output of GNU time
fn extract_time(time_str: &str) -> (f64, f64) {
    // we fail here because we assume that time.txt existing => it
    // should be valid. Ignoring time.txt requires removing it.
    let i = time_str.find_str("user ").expect("time is formatted wrong: missing user");
    let j = time_str.find_str("system ").expect("time is formatted wrong: missing system");
    // reading directly as f64 doesn't work on some computers! :(
    let user = from_str::<f64>(time_str.slice_to(i))
        .expect("time is formatted wrong: user not a f64") as f64;
    let system = from_str::<f64>(time_str.slice(i + 5, j))
        .expect("time is formatted wrong: system not a f64") as f64;
    (user, system)
}

/// A parser for the time-passes output of rustc.
pub fn pass_timing(s: &str) -> ~[(~str, f64)] {
    let mut last_indent = 0u;
    let mut subindent_count = 0u;
    s.lines().filter_map(|l| {
        if l.is_empty() {
            None
        } else {
            let indent = l.find(|c: char| c != ' ').expect("a line that's all ' '?");
            let time_start = l.slice_from(indent + 6);
            let i = time_start.find(' ').expect("invalid pass timing info (1): " + l);

            let raw_time = from_str::<f64>(time_start.slice_to(i))
                    .expect("invalid pass timing info (2): " + l);

            let i = time_start.find('\t').expect("invalid pass timing info (3): " + l);
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
            Some((time_start.slice_from(i+1).to_owned(), time))
        }
    }).collect()
}

fn main() {
    let summary_path = Path::new("out/summary.json");
    let mut summary = load_summary(&summary_path);

    // work out what we're going to process
    let mut to_process = processing_possibilities();
    for hash in already_processed(summary).move_iter() {
        to_process.remove(&hash);
    }

    // necessary in case the subtask fails
    let mut results = vec::with_capacity(to_process.len());

    for hash in to_process.move_iter() {
        let (p, c) = comm::stream();

        println(hash);

        let mut tsk = task::task();
        results.push((p, tsk.future_result()));

        // parallelism!
        do tsk.spawn {
            // as_slice, to avoid moving out of it because a proc bug
            // allows that.
            let hash_folder = Path::new("data/data").join(hash.as_slice());
            if !hash_folder.is_dir() {
                println!("{} doesn't exist; skipping.", hash);
            } else {
                let mem_path = hash_folder.join("mem.json");
                let time_path = hash_folder.join("time.txt");
                let ci_path = hash_folder.join("commit_info.txt");

                let time_file = io::result(|| File::open(&time_path));
                let time = time_file.map(|mut file| {
                    let raw_time = str::from_utf8_owned(file.read_to_end());
                    let (user, system) = extract_time(raw_time);
                    user + system
                }).into_option();

                let mut ci_file = File::open(&ci_path)
                    .expect(format!("no {}/commit_info.txt", hash));
                let raw_commit_info = str::from_utf8_owned(ci_file.read_to_end());
                let mut lines = raw_commit_info.lines();
                let (author, timestamp, summary) = match (lines.next(),
                                                          lines.next().and_then(from_str),
                                                          lines.next()) {
                    (Some(a), Some(b), Some(c)) => (a, b, c),
                    _ => fail!("invalid {}/commit_info.txt", hash)
                };

                let pull_request = if author == "bors bors@rust-lang.org" {
                    let i = summary.find('#').expect("Bors merge without a number?") + 1;
                    // a bors commit, so extract the pull request
                    let leading_num = summary.slice_from(i);
                    let non_num = leading_num.find(|c: char| !c.is_digit()).unwrap_or(0);
                    FromStr::from_str(leading_num.slice_to(non_num))
                } else {
                    None
                };

                // load the mem.json file.
                let json = File::open(&mem_path).map(|mut rdr| {
                    json::from_reader(&mut rdr as &mut Reader)
                            .expect(format!("{}/mem.json is not json", hash))
                }).expect(format!("no {}/mem.json", hash));

                let d: Data = Decodable::decode(&mut json::Decoder::new(json));
                let simple_mem = simplify_memory_data(d.memory_data);

                // if stdout is empty, this should just return nothing
                let pass_timing = pass_timing(d.stdout);

                // create & write the output
                let summary = Summary {
                    hash: hash.to_owned(),
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
                    .expect(format!("{} can't be opened", fname.display()));
                out.encode(&mut json::Encoder::new(&mut out_f as &mut Writer));
                c.send(summary);
            }
        }
    }

    // collect the summaries
    for &(ref mut p, ref mut r) in results.mut_iter() {
        match r.recv() {
            Err(_) => {} // it failed
            Ok(_) => {
                summary.push(p.recv());
            }
        }
    }

    extra::sort::tim_sort(summary);
    let mem = io::mem::with_mem_writer(
        |w| summary.encode(&mut json::Encoder::new(w as &mut Writer)));
    let text = str::from_utf8_owned(mem);

    let mut summary_f = File::create(&summary_path).expect(~"can't write to summary");
    // put one commit a line, so the diffs are smaller.
    summary_f.write(text.replace("{", "\n{").replace("]", "\n]").into_bytes());
}
