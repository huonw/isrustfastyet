#!/usr/bin/env python3
import os, glob, json, sqlite3
from collections import defaultdict

CRATES = ['arena', 'collections', 'extra',
          'flate', 'getopts', 'glob',
          'green', 'native',
          'num', 'semver', 'serialize',
          'std', 'sync', 'term',
          'test', 'time', 'uuid']

db = sqlite3.connect('../../backend/pr.sqlite3')
cur = db.cursor()

hash_vec = []

bench_path_to_index = {}
def get_bench_index(path):
    try:
        return bench_path_to_index[path]
    except KeyError:
        i = get_bench_index.bench_count
        bench_path_to_index[path] = i
        get_bench_index.bench_count += 1
        return i
get_bench_index.bench_count = 0

cur.execute('''
SELECT ROWID, STRFTIME('%%s', time, 'unixepoch'), changeset, pull_request
FROM change
WHERE datetime(time, 'unixepoch', 'utc') >= datetime('now', 'utc', '-%d day') AND
      pull_request IS NOT NULL
ORDER BY time DESC
LIMIT 500''' % 100)
changeset_data = cur.fetchall()

per_plat_benches = {}
def insert_bench(path, data):
    d = per_plat_benches
    last = len(path) - 1
    for i, section in enumerate(path):
        try:
            d = d[section]
        except KeyError:
            new = [] if i == last else {}
            d[section] = new
            d = new

    d.append(data)

changesets = {}
all_benches = set()
all_platforms = set()


for changeset_index, time, changeset, pr in changeset_data:
    cur.execute('''
SELECT plat, build_slave
FROM build
WHERE change_id = ?
''', (changeset_index,))
    changesets[changeset_index] = {'time': int(time) * 1000, 'changeset': changeset, 'pr': pr}

    for platform, build_slave in cur:
        all_platforms.add(platform)
        for platform_metrics in glob.iglob('../../build-metrics/%s/%s/%s/*-metrics.json' %
                                           (changeset[:2], changeset, platform)):
            metrics = platform_metrics.split('/')[-1]
            crate = metrics.split('-')[-2]
            if crate not in CRATES:
                continue
            name_base = crate + '::'
            path_base = [platform, crate]
            benches = json.load(open(platform_metrics))
            #print changeset, time, platform, crate, len(benches)
            for name, benches in benches.items():
                # we want [<platform>, <crate>, <module>, <everything::else::...>]
                path = path_base + name.split('::', 1)
                all_benches.add(name_base + name)
                insert_bench(path, (changeset_index, benches['value']))

def write_json(file, data):
    with open(file, 'w') as f:
        json.dump(data, f, indent=0, separators=(',', ':'), sort_keys=True)

for platform, crate_benches in per_plat_benches.items():
    for crate, module_benches in crate_benches.items():
        dir = '%s/%s' % (platform, crate)
        try:
            os.makedirs(dir)
        except OSError:
            pass
        for module, benches in module_benches.items():
            write_json('%s/%s.json' % (dir, module), benches)

write_json('changesets.json', changesets)
write_json('bench_names.json', list(sorted(all_benches)))
write_json('platforms.json', list(sorted(all_platforms)))
