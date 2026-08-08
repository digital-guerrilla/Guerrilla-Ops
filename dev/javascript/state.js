// ── Application state and shared constants ───────────────────
const db  = { types:[], components:[], spaces:[], floors:[], zones:[], systems:[], documents:[], facilities:[], contacts:[], attributes:[], coordinates:[], picklists:[], facility:null };
const idx = {};
let docStore = [];
let cardCtr  = 0;

// Shared icon and label lookup tables used by grouped result views.
const _GRP_ICONS  = {type:'bi-tag-fill',system:'bi-diagram-3-fill',space:'bi-grid-fill',floor:'bi-layers-fill',facility:'bi-building',component:'bi-tools',contact:'bi-person-fill',document:'bi-file-earmark-text',doccat:'bi-folder2-open'};
const _GRP_LABELS = {type:'Type',system:'System',space:'Space',floor:'Floor',facility:'Facility',doccat:'Document category'};

const sel = { facility: new Set(), floor: new Set(), space: new Set(), type: new Set(), system: new Set(), doccat: new Set() };
const selectedCategoryLevels = { facility:new Set(), space:new Set(), type:new Set(), system:new Set(), doccat:new Set() };
const collapsedFilterCategories = new Set();
let lastCounts = { facility:{}, floor:{}, space:{}, type:{}, system:{}, doccat:{} };
let searchQuery = '';
let viewMode = 'asset';
let _loadMode = null;

const _excelRe = /\.(xlsx|xls|xlsm)$/i;

// Shared mutable state used across multiple modules
let _changeLog = [];        // { entityType, entityName, facNames, timestamp }
let _originalDbState = null;
const _justCreated = new Set(); // "dim::name" items created this session, visible in filter even at 0 count
