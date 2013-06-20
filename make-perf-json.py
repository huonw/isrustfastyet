#!/usr/bin/env python3

import sqlite3, json, sys

db = sqlite3.connect('perf.sqlite3')

cur = db.cursor()

# only use the non-all-targets opt builds, and/or the old ones
cur.execute('''
SELECT DISTINCT plat FROM build
WHERE plat LIKE '%-32-opt' OR plat LIKE '%-64-opt' OR plat NOT LIKE '%-%' ''')
PLATFORMS = [r[0] for r in cur]

out = {}
for plat in PLATFORMS:
    # * 1000 to match javascript, and -11 days to give a buffer to make
    # * the plot look nicer
    cur.execute('''
SELECT time * 1000, changeset, pull_request, build_num, compile_time, test_time
FROM change INNER JOIN build ON change.ROWID = build.change_id
WHERE plat = ? AND datetime(time, 'unixepoch', 'utc') >= datetime('now', 'utc', '-11 day')
ORDER BY time
LIMIT 500
''', (plat,))

    compile = []
    test = []
    info = []
    for time, changeset, pull_request, build_num, compile_time, test_time in cur:
        compile.append((time,compile_time))
        test.append((time, test_time))
        info.append({'changeset': changeset, 'pull_request': pull_request, 'build_num': build_num})

    out[plat] = {'plat': plat, 'compile': compile, 'info': info, 'test': test}


with open('perf.js', 'w') as f:
    f.write('window.PERF_DATA =\n')
    json.dump(out, f, separators=(',\n', ':\n'))
    f.write('\n;')
