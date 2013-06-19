#!/usr/bin/env python3

import requests, sqlite3, json, re
from collections import defaultdict

ONLY_OPT = ['opt']
NO_VG = ['opt', 'nopt']
ALL_OPTS = ['opt', 'nopt', 'opt-vg']

OS = {
    'linux': {
        '64': ALL_OPTS,
        '32': NO_VG,
        'all': ONLY_OPT
    },
    'mac': {
        '64': ALL_OPTS,
        '32': ONLY_OPT,
        'all': ONLY_OPT
    },
    'win': {
        '32': NO_VG
    }
}

PLATFORMS = ['%s-%s-%s' % (os, arch, opt)
             for os, archs in OS.items()
             for arch, opts in archs.items()
             for opt in opts]

HISTORY = range(-10,-1 + 1)
URL = 'http://buildbot.rust-lang.org/json/builders/auto-%s/builds?' + '&'.join('select=%d' % i
                                                                               for i in HISTORY)
db = sqlite3.connect('perf.sqlite3')
cur = db.cursor()

builds = defaultdict(dict)

for plat in PLATFORMS:
    print('Downloading', plat)
    resp = json.loads(requests.get(URL % plat).text)
    print('Done')
    for i in HISTORY:
        build = resp[str(i)]
        if 'error' in build:
            print('%i: error: %s' % (i, build['error']))
            continue

        changeset = build['sourceStamp']['revision']

        try:
            assert build['text'] == ['build', 'successful']
        except (KeyError, AssertionError):
            print(changeset, 'not successful (yet)')
            continue


        builds[changeset][plat] = build



for chst, bs in builds.items():
    if len(bs) != len(PLATFORMS):
        print(chst,'missing platforms')
        continue # doesn't have all platforms

    cur.execute('SELECT 1 FROM change WHERE changeset = ?', (chst,))
    if cur.fetchone() is not None:
        print(chst, 'already done')
        continue # already done

    changes = bs[PLATFORMS[0]]['sourceStamp']['changes']
    if not changes:
        print(chst, 'not enough changes')
        continue

    changes = changes[0]
    comment = changes['comments']
    pull_request = int(re.match('auto merge of #(\d+)', comment).group(1))
    time = changes['when']

    cur.execute('INSERT INTO change (changeset, pull_request, time) VALUES (?,?,?)',
                (chst, pull_request, time))

    change_row_id = cur.lastrowid

    for plat, build in bs.items():
        build_num = build['number']

        compile_ts = build['steps'][6]['times']
        compile_time = int(compile_ts[1] - compile_ts[0])

        test_ts = build['steps'][7]['times']
        test_time = int(test_ts[1] - test_ts[0])

        cur.execute('INSERT INTO build (change_id, build_num, plat, compile_time, test_time) VALUES (?,?,?,?,?)',
                    (change_row_id, build_num, plat, compile_time, test_time))

db.commit()
