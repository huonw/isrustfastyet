#!/usr/bin/env python3

import requests, sqlite3, json, re, os, subprocess, urllib, sys
from collections import defaultdict

HISTORY = range(-10,-1 + 1)
BUILDERS_URL = 'http://buildbot.rust-lang.org/json/builders/'
URL = 'http://buildbot.rust-lang.org/json/builders/auto-%s/builds?' + '&'.join('select=%d' % i
                                                                               for i in HISTORY)
GH_URL = 'https://api.github.com/repos/rust-lang/rust/pulls/%d'
PR_INFO_DIR = '../pull_requests/'

BENCH_URL = 'http://static.rust-lang.org/build-metrics/{sha}/auto-{plat}/{slave}/bench.tar.gz'
STAB_URL = 'http://static.rust-lang.org/stab-metrics/{sha}/auto-{plat}/{slave}/stab.tar.gz'

METRICS_INFO_DIR = '../build-metrics/'


db = sqlite3.connect('pr.sqlite3')
cur = db.cursor()

PLATFORMS = [p[5:] for p in requests.get(BUILDERS_URL).json() if p.startswith('auto-')]
builds = defaultdict(dict)

for plat in PLATFORMS:
    print('Downloading %s... ' % plat,  end='')
    sys.stdout.flush()
    resp = requests.get(URL % plat).json()
    print('done.')
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
            # print(i, changeset, 'not successful (yet)')
            continue

        # print(i, changeset, 'successful')
        builds[changeset][plat] = build

# BSD is BAD (and so is a windows builder)
FILT_PLATFORMS = {p for p in PLATFORMS if 'bsd' not in p}

for chst, bs in builds.items():
    if not set(bs) >= FILT_PLATFORMS:
        print(chst,'missing platforms')
        continue # doesn't have all platforms

    cur.execute('SELECT 1 FROM change WHERE changeset = ?', (chst,))
    if cur.fetchone() is not None:
        print(chst, 'already done')
        continue # already done

    print('Handling', chst)
    changes = bs[next(iter(FILT_PLATFORMS))]['sourceStamps'][0]['changes']
    if changes:
        changes = changes[-1]
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
        print("\tRetrieving info for #%d from GitHub." % pull_request)
        dir = PR_INFO_DIR + '%02d/%d' % (pull_request // 100, pull_request)
        try:
            os.makedirs(dir)
        except OSError:
            pass # already done
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

        compile_ts = None
        test_ts = None
        for x in build['steps']:
            if x['name'] == 'compile':
                compile_ts = x['times']
            if x['name'] == 'test':
                test_ts = x['times']

        if compile_ts is None or test_ts is None:
            err = 'compile' if compile_ts is None else 'test'
            print('No "%s" phase found' % err)

        compile_time = int(compile_ts[1] - compile_ts[0])
        test_time = int(test_ts[1] - test_ts[0])
        build_slave = build['slave']

        sys.stdout.flush()
        metrics_dir = METRICS_INFO_DIR + '%s/%s/%s/' % (chst[:2], chst, plat)

        print("\tRetrieving metrics info for %s:" % plat)
        try:
            os.makedirs(metrics_dir)
        except OSError:
            print('\t\tAlready done.')
        else:
            for (name, raw_url) in [('bench', BENCH_URL), ('stab', STAB_URL)]:
                print('\t\t%s... ' % name, end = '')

                url = raw_url.format(sha = chst, plat = plat, slave = build_slave)
                file_name = name + '.tar.gz'
                full_name = metrics_dir + file_name
                try:
                    urllib.request.urlretrieve(url, filename=full_name)
                except urllib.error.HTTPError as e:
                    if e.code == 403:
                        print('failed with 403.')
                    else:
                        raise
                else:
                    print('success. Inflating...', end = '')
                    subprocess.check_call(['tar', 'xf', file_name],
                                          cwd=metrics_dir)
                    print('success.')

        cur.execute('''
        INSERT INTO build
        (change_id, build_num, plat, compile_time, test_time, build_slave)
        VALUES (?,?,?,?,?,?)''',
                    (change_row_id, build_num, plat, compile_time, test_time, build_slave))
    print(chst, 'added ok')

db.commit()
