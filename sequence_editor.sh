#!/bin/bash
# Replaces 'pick b605156' with 'reword b605156'
sed -i.bak 's/^pick b605156/reword b605156/' "$1"
