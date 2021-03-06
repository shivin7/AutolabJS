#!/bin/bash
############
# Purpose: Scoreboard tests written using BATS
# Authors: Ankshit Jain
# Dependencies:	bats (https://github.com/sstephenson/bats)
# Date : 15-Feb-2018
# Previous Versions: -
# Invocation: $bash scoreboard.sh
###########
# All variables that are exported/imported are in upper case convention. They are:
#   TESTDIR : name for the temporary directory where tests will be run
# All local variables are in lower case convention. They are:
#  msPid : pid of the main server process

set -ex
TESTDIR='scoreboard'
export TESTDIR
# Run the setup for scoreboard tests
cd ../test_modules
bash ./helper_scripts/scoreboard/scoreboard_test_setup.sh
# Kill the running main server process and restart the main server
msPid=$(tail -n 1 ../process_pid.txt)
sed -i '$ d' ../process_pid.txt
kill -SIGKILL "$msPid" > /dev/null 2>&1
cd ../../main_server
node main_server.js >>/tmp/log/main_server.log 2>&1 &
msPid="$!"
sleep 5
# Return back to the test_modules directory
cd ../tests/test_modules

# Run the scoreboard tests
$BATS bats/scoreboard.bats

# Run the teardown script to restore the necessary files.
bash ./helper_scripts/scoreboard/scoreboard_test_teardown.sh
# Kill the running main server process and restart the main server
kill -SIGKILL "$msPid" > /dev/null 2>&1
cd ../../main_server
node main_server.js >>/tmp/log/main_server.log 2>&1 &
msPid="$!"
echo "$msPid" > ../tests/process_pid.txt
sleep 5
