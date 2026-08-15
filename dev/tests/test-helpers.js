const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const javascriptDir = path.join(root, 'javascript');
const javascriptFiles = fs.readdirSync(javascriptDir)
  .filter(filename => filename.endsWith('.js'));

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function readJavascript(filename) {
  return readText(path.join(javascriptDir, filename));
}

function xmlRequestFor(xmlText) {
  return class {
    open() {}
    send() {
      this.status = 200;
      this.responseText = xmlText;
    }
  };
}

function workbook(facility, floor) {
  return {
    Sheets:{
      Facility:[{ Name:facility }],
      Floor:[floor],
    },
  };
}

function createContext({ console: testConsole = console } = {}) {
  const context = {
    console:testConsole,
    db:{
      types:[], components:[], spaces:[], floors:[], zones:[], systems:[], documents:[],
      facilities:[], contacts:[], attributes:[], coordinates:[], picklists:[], facility:null,
    },
    idx:{},
    sel:{ facility:new Set(), floor:new Set(), space:new Set(), type:new Set(), system:new Set(), doccat:new Set() },
    collapsedFilterCategories:new Set(),
    _changeLog:[],
    XLSX:{ utils:{ sheet_to_json:sheet => sheet } },
    document:{
      getElementById:() => null,
      querySelectorAll:() => [],
      addEventListener:() => {},
    },
    window:{ addEventListener:() => {} },
    searchQuery:'coordinate-test',
    collapseCounter:0,
    pendingGroups:{},
    _logChange:() => {},
  };
  vm.createContext(context);
  return context;
}

function loadModule(context, filename) {
  vm.runInContext(readJavascript(filename), context, { filename });
}

function loadModules(context, filenames) {
  filenames.forEach(filename => loadModule(context, filename));
}

function checkJavaScriptSyntax() {
  javascriptFiles.forEach(filename => {
    execFileSync(process.execPath, ['--check', path.join(javascriptDir, filename)]);
  });
}

module.exports = {
  checkJavaScriptSyntax,
  createContext,
  execFileSync,
  javascriptDir,
  javascriptFiles,
  loadModule,
  loadModules,
  path,
  readJavascript,
  readText,
  root,
  vm,
  workbook,
  xmlRequestFor,
};
