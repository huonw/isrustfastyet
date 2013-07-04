//! Converts the raw mem.json (etc) to a more useable form.

extern mod extra;
use extra::{json};
use extra::serialize::{Decodable, Encodable};
use std::{os, io, comm};
use std::hashmap::HashSet;

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
    cpu_time: f64,
    pull_request: Option<uint>
}

// The list of all hashes that we know about.
fn processing_possibilities() -> HashSet<~str> {
    let mut set = HashSet::new();
    for os::list_dir(&Path("data")).consume_iter().advance |hash| {
        if "history.txt" != hash {
            set.insert(hash);
        }
    }
    set
}

// Read the current summary json file, or "make" a new one if it
// doesn't work.
fn load_summary(p: &Path) -> ~[Summary] {
    match do io::file_reader(p).map |rdr| {
        json::from_reader(*rdr).expect(~"summary is invalid")
    } {
        Err(_) => ~[],
        Ok(json) =>  Decodable::decode(&mut json::Decoder(json))
    }
}

/// A list of commits we've already seen
fn already_processed(summary: &[Summary]) -> ~[~str] {
    summary.iter().transform(|x| x.hash.to_owned()).collect()
}

/// Reduce the number of points, while (hopefully) maintaining a
/// decent representation of the data
fn simplify_memory_data(v: &[(f64, f64)]) -> ~[(f64, f64)] {
    //line_simplify::rdp(v, 0.001)
    line_simplify::visvalingam(v, 100000.0)
}

/// A parser for the output of GNU time
fn extract_time(time_str: &str) -> (f64, f64) {
    let i = time_str.find_str("user ").expect(~"time is formatted wrong: missing user");
    let j = time_str.find_str("system ").expect(~"time is formatted wrong: missing system");
    let user = FromStr::from_str(time_str.slice_to(i))
        .expect(~"time is formatted wrong: user not a float");
    let system = FromStr::from_str(time_str.slice(i + 5, j))
        .expect(~"time is formatted wrong: system not a float");;
    (user, system)
}

/// A parser for the time-passes output of rustc.
pub fn pass_timing(s: &str) -> ~[(~str, f64)] {
    do s.line_iter().transform |l| {
        let time_start = l.slice_from(6);
        let i = time_start.find(' ').expect(~"invalid pass timing info");

        let time: f64 = FromStr::from_str(time_start.slice_to(i)).expect(~"invalid pass timing info");

        let i = time_start.find('\t').expect(~"invalid pass timing info");

        (time_start.slice_from(i+1).to_owned(), time)
    }.collect()
}

fn main() {
    let summary_path = Path("out/summary.json");
    let mut summary = load_summary(&summary_path);

    // work out what we're going to process
    let mut to_process = processing_possibilities();
    for already_processed(summary).consume_iter().advance |hash| {
        to_process.remove(&hash);
    }

    let (p, c) = comm::stream();
    let c = comm::SharedChan::new(c);

    let num = to_process.len();

    do to_process.consume |hash| {
        let cc = c.clone();
        println(hash);

        // paralellism!
        do spawn {
            let hash_folder = Path("data").push(hash);
            let mem_path = hash_folder.push("mem.json");
            let time_path = hash_folder.push("time.txt");
            let ci_path = hash_folder.push("commit_info.txt");

            let raw_time = io::read_whole_file_str(&time_path).expect(~"no time.txt");
            let (user, system) = extract_time(raw_time);
            let time = user + system;

            let raw_commit_info = io::read_whole_file_str(&ci_path).expect(~"no commit_info.txt");
            let mut lines = raw_commit_info.line_iter();
            let (author, timestamp, summary) = match (lines.next(),
                                                 lines.next().chain(|x| FromStr::from_str(x)),
                                                 lines.next()) {
                (Some(a), Some(b), Some(c)) => (a, b, c),
                _ => fail!("invalid commit_info format")
            };

            let pull_request = if author == "bors bors@rust-lang.org" {
                // a bors commit, so extract the pull request
                let leading_num = summary.slice_from("auto merge of #".len());
                let non_num = leading_num.find(|c: char| !c.is_digit()).get_or_zero();
                FromStr::from_str(leading_num.slice_to(non_num))
            } else {
                None
            };

            // load the mem.json file.
            let json = do io::file_reader(&mem_path).map |rdr| {
                json::from_reader(*rdr).expect(~"mem.json is not json")
            }.expect(~"no mem.json");

            let d: Data = Decodable::decode(&mut json::Decoder(json));
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

            let fname = Path("out").push(hash + ".json");
            let out_f = io::file_writer(&fname, [io::Create, io::Truncate]).expect(~"out file can't be opened");
            out.encode(&mut json::Encoder(out_f));
            cc.send(summary);
        }
    }

    // collect the summaries
    for num.times {
        summary.push(p.recv());
    }
    extra::sort::tim_sort(summary);
    let summary_f = io::file_writer(&summary_path, [io::Create, io::Truncate]).unwrap();
    summary.encode(&mut json::Encoder(summary_f));
}
