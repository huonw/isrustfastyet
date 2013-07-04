//! Converts the raw mem.json (etc) to a more useable form.

extern mod extra;
use extra::{json};
use extra::serialize::{Decodable, Encodable};
use std::{os, io, comm};
use std::hashmap::HashSet;

mod line_simplify;

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
        json::from_reader(*rdr).unwrap()
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
            let mem_path = Path("data").push_many([hash.as_slice(), "mem.json"]);
            let ci_path = Path("data").push_many([hash.as_slice(), "commit_info.txt"]);

            let raw_commit_info = io::read_whole_file_str(&ci_path).unwrap();
            let mut lines = raw_commit_info.line_iter();
            let (author, time, summary) = match (lines.next(),
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
                json::from_reader(*rdr).unwrap()
            }.unwrap();

            let d: Data = Decodable::decode(&mut json::Decoder(json));
            let simple_mem = simplify_memory_data(d.memory_data);

            let usage = d.cpuacct.usage as f64 * 1e-9;

            // create & write the output
            let summary = Summary {
                hash: hash.to_owned(),
                timestamp: time,
                cpu_time: usage,
                max_memory: d.max_memory as f64,
                pull_request: pull_request
            };
            let out = Output {
                memory_data: simple_mem,
                summary: summary.clone()
            };

            let fname = Path("out").push(hash + ".json");
            let out_f = io::file_writer(&fname, [io::Create, io::Truncate]).unwrap();
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
