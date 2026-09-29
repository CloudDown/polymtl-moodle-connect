#!/bin/sh
DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
"$DIR/polymtl-moodle-connect" install
