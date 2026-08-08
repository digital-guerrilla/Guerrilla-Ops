// ── Application state and shared constants ───────────────────
const db  = { types:[], components:[], spaces:[], floors:[], zones:[], systems:[], documents:[], facilities:[], contacts:[], attributes:[], coordinates:[], picklists:[] };
const idx = {};
let docStore = [];
let cardCtr  = 0;

// Shared icon and label lookup tables used by grouped result views.
const _GRP_ICONS  = {};
const _GRP_LABELS = {};

const sel = {};
const selectedCategoryLevels = {};
const collapsedFilterCategories = new Set();
let lastCounts = {};
let searchQuery = '';
let viewMode = 'asset';
let _loadMode = null;

const _excelRe = /\.(xlsx|xls|xlsm)$/i;

// Shared mutable state used across multiple modules
let _changeLog = [];        // { entityType, entityName, facNames, timestamp }
let _originalDbState = null;
const _justCreated = new Set(); // "dim::name" items created this session, visible in filter even at 0 count
