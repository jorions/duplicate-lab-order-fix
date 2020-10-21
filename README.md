# How to run
- There are dry run variants of each script, which will log the changes that would be applied without actually applying the changes.
- To see a preview of what changes will be made: `yarn dryRun-<SCRIPT>`
- To actually apply these changes: `yarn <SCRIPT>`
- So the options are:
  - `yarn fix`
  - `yarn dryRun-fix`
  - `yarn fixTwo`
  - `yarn dryRun-fixTwo`

# Flags
- `lrr`
  - Ex: `-lrr=123,456,789`
  - Logs the Lab Order and Reorder Request timeline that is used internally for determining Lab Reorder Request updates. Pass the LabReorderRequestIds that you want to log the timelines for.
