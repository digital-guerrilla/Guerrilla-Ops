// ── Application state and shared constants ───────────────────
function _createRecordStore() {
	const collections = Object.create(null);
	return new Proxy(collections, {
		get(target, key) {
			if (typeof key === 'string' && !Object.prototype.hasOwnProperty.call(target, key)) target[key] = [];
			return target[key];
		},
	});
}

function _createLazyStateStore(createValue) {
	const values = Object.create(null);
	return new Proxy(values, {
		get(target, key) {
			if (typeof key === 'string' && !Object.prototype.hasOwnProperty.call(target, key)) target[key] = createValue();
			return target[key];
		},
	});
}

function _createSelectionStore() { return _createLazyStateStore(() => new Set()); }
function _createFilterCountStore() { return _createLazyStateStore(() => ({})); }

const db  = _createRecordStore();
const idx = {};
let docStore = [];
let cardCtr  = 0;

// Shared icon and label lookup tables used by grouped result views.
const _GRP_ICONS  = {};
const _GRP_LABELS = {};

const sel = _createSelectionStore();
const selectedCategoryLevels = _createSelectionStore();
const collapsedFilterCategories = new Set();
let lastCounts = _createFilterCountStore();
let searchQuery = '';
let viewMode = 'asset';
let _loadMode = null;

const _excelRe = /\.(xlsx|xls|xlsm)$/i;

// Shared mutable state used across multiple modules
let _changeLog = [];        // { entityType, entityName, facNames, timestamp }
let _originalDbState = null;
const _justCreated = new Set(); // "dim::name" items created this session, visible in filter even at 0 count
