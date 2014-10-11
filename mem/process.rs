//! Converts the raw mem.json (etc) to a more useable form.

extern crate serialize;
extern crate collections;
use serialize::{json, Decodable, Encodable};
use std::task;
use std::io::{mod, fs, File};
use std::io::fs::PathExtensions;
use std::collections::HashSet;

mod line_simplify;

trait Expect<T> { fn expect(self, String) -> T; }
impl<T, U> Expect<T> for Result<T, U> {
    fn expect(self, s: String) -> T {
        match self {
            Ok(a) => a,
            Err(_) => fail!(s)
        }
    }
}

// these reflect the structure of mem.json exactly

#[deriving(Decodable)]
#[allow(dead_code)]
struct CPUAcct {
    hz: f64,
    usage: uint,
    user: f64,
    system: f64
}

#[deriving(Decodable)]
#[allow(dead_code)]
struct Data {
    cli: String,
    stdout: String,
    stderr: String,
    elapsed: f64,
    cpuacct: CPUAcct,
    max_memory: uint,
    memory_data: Vec<(f64, f64)>,
}

// these form the format we wish to output.
#[deriving(Encodable)]
struct Output {
    summary: Summary,
    memory_data: Vec<(f64, f64)>,
    pass_timing: Vec<(String, f64)>,
}

#[deriving(Encodable, Decodable, Clone, PartialOrd, PartialEq)]
struct Summary {
    timestamp: uint,
    hash: String,
    max_memory: f64,
    cpu_time: Option<f64>,
    pull_request: Option<uint>
}

// The list of all hashes that we know about.
fn processing_possibilities() -> HashSet<String> {
    fs::readdir(&Path::new("data/data"))
        .expect("couldn't read data/data".into_string())
        .into_iter()
        .filter_map(|hash| hash.filename_str().map(|s| s.into_string()))
        .filter(|hash| "history.txt" != hash.as_slice())
        .collect()
}

// Read the current summary json file, or "make" a new one if it
// doesn't work.
fn load_summary(p: &Path) -> Vec<Summary> {
    match File::open(p).map(|mut rdr| {
        json::from_reader(&mut rdr as &mut Reader).expect("summary is invalid".into_string())
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
pub fn pass_timing(s: &str) -> Vec<(String, f64)> {
    let mut last_indent = 0u;
    let mut subindent_count = 0u;
    s.lines().filter_map(|l| {
        if l.is_empty() {
            None
        } else {
            let indent = l.find(|c: char| c != ' ').expect("a line that's all ' '?");
            let time_start = l.slice_from(indent + 6);
            let i = time_start.find(' ').expect(format!("invalid pass timing info (1): {}", l)
                                                .as_slice());

            let raw_time = from_str::<f64>(time_start.slice_to(i))
                    .expect(format!("invalid pass timing info (2): {}", l).as_slice());

            let i = time_start.find('\t')
                .expect(format!("invalid pass timing info (3): {}", l).as_slice());
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
            Some((time_start.slice_from(i+1).into_string(), time))
        }
    }).collect()
}

fn main() {
    let summary_path = Path::new("out/summary.json");
    let mut summary = load_summary(&summary_path);

    // work out what we're going to process
    let mut to_process = processing_possibilities();
    for hash in already_processed(summary.as_slice()).into_iter() {
        to_process.remove(&hash);
    }

    // necessary in case the subtask fails
    let mut results = Vec::with_capacity(to_process.len());

    for hash in to_process.into_iter() {
        let (c, p) = channel();

        println!("{}", hash);

        let tsk = task::TaskBuilder::new();

        // parallelism!
        results.push((p, tsk.try_future(proc() {
            // as_slice, to avoid moving out of it because a proc bug
            // allows that.
            let hash_folder = Path::new("data/data").join(hash.as_slice());
            if !hash_folder.is_dir() {
                println!("{} doesn't exist; skipping.", hash);
            } else {
                let mem_path = hash_folder.join("mem.json");
                let time_path = hash_folder.join("time.txt");
                let ci_path = hash_folder.join("commit_info.txt");

                let time_file = File::open(&time_path);
                let time = time_file.map(|mut file| {
                    let raw_time =
                        String::from_utf8(file.read_to_end()
                                           .expect("Couldn't read time.txt".into_string()));
                    let (user, system) = extract_time(raw_time
                                                      .expect("Non-utf8 time.txt".into_string())
                                                      .as_slice());
                    user + system
                });
                let time = match time { Ok(o) => Some(o), Err(_) => None };

                let mut ci_file = File::open(&ci_path)
                    .expect(format!("no {}/commit_info.txt", hash));
                let raw_commit_info =
                    String::from_utf8(ci_file.read_to_end()
                                      .expect("couldn't read commit_info.txt".into_string()))
                        .expect("Non-utf8 commit_info.txt".into_string());
                let mut lines = raw_commit_info.as_slice().lines();
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
                    from_str(leading_num.slice_to(non_num))
                } else {
                    None
                };

                // load the mem.json file.
                let json = File::open(&mem_path).map(|mut rdr| {
                    json::from_reader(&mut rdr as &mut Reader)
                            .expect(format!("{}/mem.json is not json", hash))
                }).expect(format!("no {}/mem.json", hash));

                let d: Data = Decodable::decode(&mut json::Decoder::new(json)).unwrap();
                let simple_mem = simplify_memory_data(d.memory_data.as_slice());

                // if stdout is empty, this should just return nothing
                let pass_timing = pass_timing(d.stdout.as_slice());

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
                    .expect(format!("{} can't be opened", fname.display()));
                out.encode(&mut json::Encoder::new(&mut out_f as &mut Writer)).unwrap();
                c.send(summary);
            }
        })))
    }

    // collect the summaries
    for (p, r) in results.into_iter() {
        match r.unwrap() {
            Err(_) => {} // it failed
            Ok(_) => {
                summary.push(p.recv());
            }
        }
    }

    summary.sort_by(|x, y| if *x < *y {Less} else if *x == *y {Equal} else {Greater});

    let mut w = io::MemWriter::new();
    summary.encode(&mut json::Encoder::new(&mut w as &mut Writer)).unwrap();
    let text = String::from_utf8(w.unwrap()).expect("Non-utf8 JSON written".into_string());

    let mut summary_f = File::create(&summary_path).expect("can't write to summary".into_string());
    // put one commit a line, so the diffs are smaller.
    summary_f.write(text.replace("{", "\n{").replace("]", "\n]").as_bytes()).unwrap();
}
