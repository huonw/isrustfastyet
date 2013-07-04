extern mod extra;
use extra::{json};
use extra::serialize::{Decodable, Encodable};
use std::{os, io, run, str, comm};
use std::hashmap::HashSet;

mod line_simplify;

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

fn processing_possibilities() -> HashSet<~str> {
    let mut set = HashSet::new();
    for os::list_dir(&Path("data")).consume_iter().advance |hash| {
        if "history.txt" != hash {
            set.insert(hash);
        }
    }
    set
}

fn load_summary(p: &Path) -> ~[Summary] {
    match do io::file_reader(p).map |rdr| {
        json::from_reader(*rdr).unwrap()
    } {
        Err(e) => ~[],
        Ok(json) =>  Decodable::decode(&mut json::Decoder(json))
    }
}

fn already_processed(summary: &[Summary]) -> ~[~str] {
    summary.iter().transform(|x| x.hash.to_owned()).collect()
}


fn simplify_memory_data(v: &[(f64, f64)]) -> ~[(f64, f64)] {
    //line_simplify::rdp(v, 0.001)
    line_simplify::visvalingam(v, 100000.0)
}

fn get_hash_timestamp(hash: &str) -> uint {
    let run::ProcessOutput{status,output,error} =
        run::process_output("git", [~"show", ~"-s", ~"--format=%at", hash.to_owned()]);
    if status != 0 { fail!("git failed %d: %s", status, str::from_bytes(error)); }
    let out = str::from_bytes(output);
    FromStr::from_str(out.trim()).unwrap()
}

fn main() {
    let rust_dir = match os::args() {
        [_, dir, .. _] => Path(dir),
        _ => match os::homedir() {
            Some(home) => home.push("rust"),
            None => fail!("no rust dir")
        }
    };

    let summary_path = Path("out/summary.json");
    let mut summary = load_summary(&summary_path);

    let mut to_process = processing_possibilities();
    for already_processed(summary).consume_iter().advance |hash| {
        to_process.remove(&hash);
    }

    let current_dir = os::getcwd();

    let (p, c) = comm::stream();
    let c = comm::SharedChan::new(c);

    let num = to_process.len();

    do to_process.consume |hash| {
        let cc = c.clone();
        println(hash);

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
                let leading_num = summary.slice_from("auto merge of #".len());
                let non_num = leading_num.find(|c: char| !c.is_digit()).get_or_zero();
                FromStr::from_str(leading_num.slice_to(non_num))
            } else {
                None
            };


            let json = do io::file_reader(&mem_path).map |rdr| {
                json::from_reader(*rdr).unwrap()
            }.unwrap();

            let d: Data = Decodable::decode(&mut json::Decoder(json));
            let simple_mem = simplify_memory_data(d.memory_data);

            let fname = Path("out").push(hash + ".json");
            let usage = d.cpuacct.usage as f64 * 1e-9;
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

            let out_f = io::file_writer(&fname, [io::Create, io::Truncate]).unwrap();
            out.encode(&mut json::Encoder(out_f));
            cc.send(summary);
        }
    }

    for num.times {
        summary.push(p.recv());
    }
    extra::sort::tim_sort(summary);
    let summary_f = io::file_writer(&summary_path, [io::Create, io::Truncate]).unwrap();
    summary.encode(&mut json::Encoder(summary_f));
}
