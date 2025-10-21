#!/bin/bash

# This script will remove all node_modules directories within the functions directory and its subdirectories.
# It will then run npm install in each directory containing a package.json file.

echo "Removing all node_modules directories in functions..."
find functions -name "node_modules" -type d -exec rm -rf {} +
echo "All node_modules directories have been removed."

echo "Reinstalling packages for all functions..."
find functions -name "package.json" -print -execdir npm install \;

echo "Reinstallation complete."
