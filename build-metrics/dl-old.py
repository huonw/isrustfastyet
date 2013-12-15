#!/usr/bin/env python3

import sqlite3, glob, os, sys
from urllib import request, error
from collections import defaultdict

DB_PATH = '../backend/pr.sqlite3'
BENCH_URL = 'http://static.rust-lang.org/build-metrics/{sha}/auto-{plat}/{slave}/'

EXAMPLE = 'fb/fbbadae80ffda04132e6cf1155e32cc6f910712d/'

plat_filenames = defaultdict(list)
for name in glob.iglob(EXAMPLE + '*/*.json'):
    _, _, plat, fname = name.split('/')
    plat_filenames[plat].append(fname)

db = sqlite3.connect(DB_PATH)
cur = db.cursor()

cur.execute('''
SELECT ROWID, changeset
FROM change
WHERE datetime(time, 'unixepoch', 'utc') >= datetime('now', 'utc', '-20 day')
ORDER BY time
''')

changesets = cur.fetchall()

for id, chst in changesets[1:]:
    cur.execute('''
    SELECT plat, build_slave FROM build WHERE change_id = ?
    ''', (id,))
    print(chst)
    for plat, slave in cur:
        base_bench_url = BENCH_URL.format(sha=chst, plat=plat, slave=slave)
        bench_dir = '%s/%s/%s/' % (chst[:2], chst, plat)
        print("\tRetrieving bench info for %s..." % plat)
        try:
            os.makedirs(bench_dir)
        except OSError:
            pass
        if not plat_filenames[plat]:
            print('\t\tno benches known.')
        for fname in plat_filenames[plat]:
            print('\t\t%s... ' % fname, end='')
            out_name = bench_dir + fname

            if os.path.isfile(out_name):
                print('already done.')
                continue
            try:
                request.urlretrieve(base_bench_url + fname,
                                    filename=out_name)
                print('ok.')
            except error.HTTPError as e:
                if e.code == 403:
                    print('failed with 403.')
                else:
                    raise
