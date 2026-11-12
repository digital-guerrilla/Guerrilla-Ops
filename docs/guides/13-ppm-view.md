# PPM View

[Guide index](README.md)

PPM means Planned Preventive Maintenance. It is a separate working mode beside
Asset, Document and QA. All processing remains in your browser.

## Prepare Jobs

Open **PPM View**, then **Jobs** to inspect existing Job rows, or **New Job** to
create a COBie 2.4 template. Choose the owning workbook. Fields, control types,
lookup sources and defaults come from XML; unknown imported columns are retained.

- Jobs target an equipment `TypeName`.
- A Type target expands into an independent schedule for each installed Component.
- Use a positive `Frequency` / `FrequencyUnit`.
- Supported units are minutes, hours, days, weeks, months, quarters and years, including
  their XML-defined aliases. Month/year amounts must represent whole months.
- `Duration` must be nonnegative and have a supported `DurationUnit`.
- For a task series, use the same Name and TypeName. Task numbers must be
  unambiguous in that series.
- Task 0 is the series' summary milestone when other tasks exist. It does not
  add executable maintenance duration or require a separate completion.
- `Priors` is a comma-separated list of predecessor task numbers.
- `ResourceNames` provides resource descriptions, not
  capacity planning or labour allocation.

The form provides picklists for CreatedBy (workbook Contacts), TypeName (loaded
Types in the same Facility), resources, and predecessor task numbers in the same
series. ResourceNames and Priors support multiple selections. Changing Name,
TypeName or TaskNumber refreshes the predecessor choices and excludes the task
itself.

Category, Status, time units and ExtObject use the workbook's Picklist columns
JobType, JobStatus, DurationUnit and objJob. XML suggestions are used only when
that workbook has no values. Unsupported scheduling units remain visible but
cannot be used to create a fixed-cycle schedule. Existing out-of-list values are
shown explicitly and retained until changed.

New Jobs receive a GUID ExtIdentifier and a CreatedOn timestamp. **Generate
identifier** explicitly generates a replacement; existing identifiers are not
overwritten automatically. CreatedOn has a date/time selector. Workbook changes
preserve the current draft and generated identifier.

An incomplete template may be saved, but remains visibly unresolved until its
target, interval, duration and dependency graph are usable. The Job details
provide an edit action for each task. Edits that change scheduled dates require
a preview; edits that would rewrite completed history are rejected.

## Create a schedule

1. Find a resolved Component / Job series under **Unscheduled / unresolved**.
2. Select **Schedule**.
3. Use the date selector for its first maintenance date; choose **Date and time**
   to include a time.
4. Create the fixed-cycle schedule.

CreatedOn is audit information, not a maintenance anchor. Numeric Start
and TaskStartUnit values are preserved but do not establish calendar dates.

Recurrence uses the original anchor, not the last completion. For example, a
monthly schedule starting 31 January projects to the last day of February and
then 31 March. Finishing late does not shift that cycle.

## Summary, Gantt and calendar

Choose a month, status, and **Gantt** or **Calendar**. Use **Today** and the
previous/next month buttons to navigate.
Use **Window start** and **End (exclusive)** to narrow the selected month,
particularly for high-frequency maintenance. The end date is a finish boundary,
not an extra included calendar day.

- Cards count executable task occurrences in the selected month: overdue,
  outstanding and completed. A separate count shows unscheduled Component /
  Job series, not task occurrences.
- Filter drawers count matching Component / Job series.
- Calendar shows entries on the days they occupy; an occurrence spanning days
  may therefore appear on several days but counts only once in the summary.
- Gantt shows durations and predecessor connections, with horizontal scrolling
  for the month and vertical scrolling for large lists.
- Facility, spatial, Type and System filters follow resolved Components.
  Document Category selections are retained but explicitly ignored in PPM.
- Search uses the Job search fields declared in XML and the Component/Facility.
- Open an occurrence for planned dates, dependency information and saved
  completion history.

Projection is bounded to the requested month plus overlapping durations and
saved exceptions/history. The XML sets a safety ceiling of 20,000 calculated
occurrences; exceeding it raises an explicit error, never a silently truncated
schedule. Narrow the date window or restrict loaded workbooks if it is exceeded.

## Move work

Drag an unfinished Gantt bar horizontally or drop a calendar entry onto a new
day. The same operation is available without dragging: open the occurrence and
edit **Requested start**.

Choose:

- **This occurrence only**: retain the original future cycle.
- **This and future unfinished cycles**: create a new fixed-cycle segment
  beginning with this cycle. Earlier cycles and completed history remain intact.

The move preserves duration. **Preview changes** lists affected tasks and dates.
Only **Apply all changes** mutates the workbook. Cancel or Escape leaves it
unchanged. A dependent task may start later than requested if its predecessors
are not scheduled to finish by that date.

Dependencies are finish-to-start within the same Component, task series and
recurrence cycle. The scheduler recalculates unfinished successors, respecting
their nominal or explicitly requested earliest dates. Missing predecessors,
self-links, ambiguous task numbers and cycles block unsafe scheduling.

## Record completion

Open an occurrence, choose **Completed**, select **Actual completion** using its
date/date-time control, and preview/apply the change. Complete its predecessors first.
Rescheduling and completion are separate actions.

Late actual completion delays affected unfinished successors within that cycle.
It does not re-anchor later maintenance. Completed history is read-only and
belongs only to the selected Component, not the shared Job template.

Date-only anchors are calendar dates, not timezone-dependent instants.
Sub-day durations produce a date/time. Explicit timestamp offsets are retained;
there is no automatic conversion to the browser's local timezone or regional
holiday/working-hours calendar.

## Save and compatibility

Use the existing **Unsaved Changes** controls to update or download workbooks.
Save before closing or refreshing.

Each schedule anchor or saved occurrence is a COBie 2.4 Attribute row:
`Name=PPM.Record.<record identifier>`, `SheetName=Job`, and `RowName=<Job Name>`.
Its Value contains JSON fields and operational metadata for the Component,
task identity, fixed anchor, series segments, cycle, dates, status and actual
completion. Record fields, metadata roles, labels and the Attribute name prefix
are XML-defined. This JSON payload is an application extension, not a new
standard COBie column. Event and Company sheets are not generated or managed.

Untouched future occurrences are projected from the saved anchor. Browsing does
not create rows or dirty the workbook. Explicit moves and completions are saved;
reopening reconstructs the same schedule. **Discard All** restores the Job and
Attribute data.

Imported headers are not automatically renamed. Only COBie 2.4 Job fields are
used for scheduling. Previously saved app-owned PPM schedules using 2.4 Jobs
remain readable; editing them writes Job-linked Attribute records, which take
precedence over their earlier representation. Unmanaged original sheets are
retained on supported workbook saves, not deleted or adopted as maintenance
records. Ambiguous identities must be resolved rather than guessed.

PPM does not provide external calendar sync, notifications, work-order dispatch,
meter-based recurrence or resource-capacity optimisation.
