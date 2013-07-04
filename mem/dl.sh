#!/bin/bash

DL_DIR=data
BASE_URL='http://hnn.mrsd.org/~cmr/'
HIST_FILE=history.txt
MEM_FILE=mem.json
TIME_FILE=time.txt

cd $DL_DIR

curl -s ${BASE_URL}${HIST_FILE} -o ${HIST_FILE}

# Check for any hashes that haven't been downloaded (i.e. there is no
# directory with the same name)
for hash in $(grep -v -f <(ls) history.txt); do
    echo $hash
    mkdir $hash
    curl -s ${BASE_URL}${hash}/${MEM_FILE} -o ${hash}/${MEM_FILE}
    curl -s ${BASE_URL}${hash}/${TIME_FILE} -o ${hash}/${TIME_FILE}
done
