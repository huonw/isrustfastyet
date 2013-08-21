#!/usr/bin/env python3

import requests, sqlite3, json, re, os
from collections import defaultdict

ONLY_OPT = ['opt']
NO_VG = ['opt', 'nopt-c', 'nopt-t']
ALL_OPTS = ['opt', 'nopt-c', 'nopt-t', 'opt-vg']
X_ANDROID = ['x-android']

OS = {
    'linux': {
        '64': NO_VG + X_ANDROID, # ALL_OPTS,
        '32': NO_VG,
        # 'all': ONLY_OPT
    },
    'mac': {
        '64': NO_VG,
        '32': ONLY_OPT,
        # 'all': ONLY_OPT
    },
    'win': {
        '32': NO_VG
    },
    'bsd': {
        '64': ONLY_OPT
    }
}

PLATFORMS = ['%s-%s-%s' % (os, arch, opt)
             for os, archs in OS.items()
             for arch, opts in archs.items()
             for opt in opts]

HISTORY = range(-10,-1 + 1)
URL = 'http://buildbot.rust-lang.org/json/builders/auto-%s/builds?' + '&'.join('select=%d' % i
                                                                               for i in HISTORY)
GH_URL = 'https://api.github.com/repos/mozilla/rust/pulls/%d'
PR_INFO_DIR = '../pull_requests/'

db = sqlite3.connect('pr.sqlite3')
cur = db.cursor()

builds = defaultdict(dict)

for plat in PLATFORMS:
    print('Downloading', plat)
    resp = requests.get(URL % plat).json()
    print('Done')
    for i in HISTORY:
        build = resp[str(i)]
        if 'error' in build:
            print('%i: error: %s' % (i, build['error']))
            continue

        changeset = build['sourceStamps'][0]['revision']

        try:
            assert build['text'] == ['build', 'successful']
            assert changeset is not None
        except (KeyError, AssertionError):
            print(i, changeset, 'not successful (yet)')
            continue

        print(i, changeset, 'successful')
        builds[changeset][plat] = build



for chst, bs in builds.items():
    if len(bs) != len(PLATFORMS):
        print(chst,'missing platforms')
        continue # doesn't have all platforms

    cur.execute('SELECT 1 FROM change WHERE changeset = ?', (chst,))
    if cur.fetchone() is not None:
        print(chst, 'already done')
        continue # already done

    changes = bs[PLATFORMS[0]]['sourceStamps'][0]['changes']
    if changes:
        changes = changes[0]
        comment = changes['comments']
        try:
            pull_request = int(re.match('auto merge of #(\d+)', comment).group(1))
        except:
            pull_request = None # not a merge commit
        time = changes['when']
    else:
        comment = ''
        pull_request = None
        time = build['steps'][0]['times'][0] # approximate the time with the time the build started

    if pull_request:
        print("Retrieving info for %d from GitHub." % pull_request)
        dir = PR_INFO_DIR + '%02d/%d' % (pull_request // 100, pull_request)
        try:
            os.makedirs(dir)
        except OSError:
            pass # already done
        else:
            github_info = requests.get(GH_URL % pull_request).json()
            with open('%s/title.txt' % dir, 'w') as f:
                f.write(github_info['title'])
            with open('%s/merge_commit.txt' % dir, 'w') as f:
                to_write = github_info.get('merge_commit_sha')
                f.write(to_write if to_write is not None else '')

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
    print(chst, 'added ok')

db.commit()
