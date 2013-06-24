#!/usr/bin/env python3

import sqlite3, json, sys

db = sqlite3.connect('perf.sqlite3')

cur = db.cursor()

if len(sys.argv) > 1 and sys.argv[1] == 'all':
    FILTER = ''
    FILE_NAME = 'all.js'
    AGE = 10
else:
    FILTER = '''WHERE plat LIKE '%-32-opt' OR plat LIKE '%-64-opt' OR plat NOT LIKE '%-%' '''
    FILE_NAME = 'perf.js'
    AGE = 10

# only use the non-all-targets opt builds, and/or the old ones
cur.execute('SELECT DISTINCT plat FROM build %s' % FILTER)
PLATFORMS = [r[0] for r in cur]

out = {}
for plat in PLATFORMS:
    # * 1000 to match javascript, and -11 days to give a buffer to make
    # * the plot look nicer
    cur.execute('''
SELECT time * 1000, changeset, pull_request, build_num, compile_time, test_time
FROM change INNER JOIN build ON change.ROWID = build.change_id
WHERE plat = ? AND datetime(time, 'unixepoch', 'utc') >= datetime('now', 'utc', '-%d day')
ORDER BY time
LIMIT 500
''' % (AGE + 1), (plat,))

    compile = []
    test = []
    info = []
    for time, changeset, pull_request, build_num, compile_time, test_time in cur:
        compile.append((time,compile_time))
        test.append((time, test_time))
        info.append({'changeset': changeset, 'pull_request': pull_request, 'build_num': build_num})

    out[plat] = {'plat': plat, 'compile': compile, 'info': info, 'test': test}


with open(FILE_NAME, 'w') as f:
    f.write('window.PERF_DATA =\n')
    json.dump(out, f, separators=(',\n', ':\n'))
    f.write('\n;')
