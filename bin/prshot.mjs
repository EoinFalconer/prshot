#!/usr/bin/env node
/* eslint-disable no-console */
import {run} from '../src/index.mjs'

run(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err?.stack || err?.message || String(err))
    process.exit(1)
  })
