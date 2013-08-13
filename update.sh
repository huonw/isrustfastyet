#!/bin/bash
git pull --rebase

(
    cd backend

    ./get_landed_prs.py &&
    git add ../pull_requests &&
    git commit -m 'Fetch new pull requests.'

    cd ..
    (
        cd buildbot
        ./make-perf-json.py &&
        ./make-perf-json.py all &&
        git add {perf,all}.js &&
        git commit -m 'Update buildbot.'
    )

    (
        cd pull_requests
        ./pr_list.py &&
        git add index.html &&
        git commit -m 'Update pull_requests.'
    )
)

#(
#    cd mem
#    rustc -O process.rs &&
#      ./dl.sh &&
#      ./process &&
#      git add out/*.json &&
#      git commit -m 'Update mem. '
#)

git push
