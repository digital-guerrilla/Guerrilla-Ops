// ── Modal model configuration ────────────────────────────────
// Config-only module used by information modals.
// Cards define labels and COBie header aliases for each entity type.

const MODEL_MODAL_CONFIG = Object.freeze({
  facility: {
    title: 'Project Information',
    headerColorToken: 'facility',
    cards: {
      identification: {
        title: 'Identification',
        colorToken: 'facility',
        fields: [
          { label:'Name', aliases:['Name'], edit:'text' },
          { label:'Description', aliases:['Description'], edit:'text' },
          { label:'Category', aliases:['Category'], edit:'lookup', lookupSource:'category' },
          { label:'Created By', aliases:['CreatedBy', 'Created By'], edit:'lookup', lookupSource:'contact' },
          { label:'Site Name', aliases:['SiteName', 'Site Name', 'Site'], edit:'text' },
          { label:'Site Description', aliases:['SiteDescription', 'Site Description'], edit:'text' },
        ],
      },
      uniclass: {
        title: 'Uniclass',
        colorToken: 'facility',
        fields: [],
      },
      machine: {
        title: 'Machine',
        colorToken: 'facility',
        fields: [
          { label:'Project Ident', aliases:['ProjectIdent', 'Project Ident', 'ProjectIdentifier', 'Project Identifier', 'ProjectCode', 'Project Code'], edit:'text' },
          { label:'Site Ident', aliases:['SiteIdent', 'Site Ident', 'SiteIdentifier', 'Site Identifier'], edit:'text' },
          { label:'Facility Ident', aliases:['FacilityIdent', 'Facility Ident', 'FacilityIdentifier', 'Facility Identifier', 'ExtIdentifier', 'Ext Identifier'], edit:'text' },
        ],
      },
      attributes: {
        title: 'Additional Attributes',
        colorToken: 'facility',
        mode: 'attributes',
      },
      documents: {
        title: 'Documents',
        colorToken: 'doccat',
        mode: 'documents',
      },
    },
  },

  floor: {
    title: 'Floor Information',
    headerColorToken: 'floor',
    cards: {
      identification: {
        title: 'Identification',
        colorToken: 'floor',
        fields: [
          { label:'Name', aliases:['Name'], edit:'text' },
          { label:'Category', aliases:['Category'], edit:'lookup', lookupSource:'category' },
          { label:'Description', aliases:['Description'], edit:'text' },
          { label:'Created By', aliases:['CreatedBy', 'Created By'], edit:'lookup', lookupSource:'contact' },
        ],
      },
      geometry: {
        title: 'Geometry',
        colorToken: 'floor',
        fields: [
          { label:'Floor Type', aliases:['FloorType', 'Floor Type'], edit:'text' },
          { label:'Height', aliases:['Height'], edit:'text' },
          { label:'Elevation', aliases:['Elevation'], edit:'text' },
        ],
      },
      attributes: {
        title: 'Additional Attributes',
        colorToken: 'floor',
        mode: 'attributes',
      },
      documents: {
        title: 'Documents',
        colorToken: 'doccat',
        mode: 'documents',
      },
    },
  },

  space: {
    title: 'Space Information',
    headerColorToken: 'space',
    cards: {
      identification: {
        title: 'Identification',
        colorToken: 'space',
        fields: [
          { label:'Name', aliases:['Name'], edit:'text' },
          { label:'Category', aliases:['Category'], edit:'lookup', lookupSource:'category' },
          { label:'Description', aliases:['Description'], edit:'text' },
          { label:'Floor', aliases:['FloorName', 'Floor Name', 'Floor'], edit:'lookup', lookupSource:'floor' },
          { label:'Created By', aliases:['CreatedBy', 'Created By'], edit:'lookup', lookupSource:'contact' },
        ],
      },
      measurements: {
        title: 'Measurements',
        colorToken: 'space',
        fields: [
          { label:'Gross Area', aliases:['GrossArea', 'Gross Area'], edit:'text' },
          { label:'Net Area', aliases:['NetArea', 'Net Area'], edit:'text' },
          { label:'Usable Height', aliases:['UsableHeight', 'Usable Height'], edit:'text' },
          { label:'Gross Perimeter', aliases:['GrossPerimeter', 'Gross Perimeter'], edit:'text' },
          { label:'Net Perimeter', aliases:['NetPerimeter', 'Net Perimeter'], edit:'text' },
          { label:'Room Tag', aliases:['RoomTag', 'Room Tag'], edit:'text' },
        ],
      },
      associations: {
        title: 'Associations',
        colorToken: 'space',
        mode: 'associations',
        associations: [
          { key:'components', label:'Components', targetType:'component', cardinality:'many' },
        ],
      },
      attributes: {
        title: 'Additional Attributes',
        colorToken: 'space',
        mode: 'attributes',
      },
      documents: {
        title: 'Documents',
        colorToken: 'doccat',
        mode: 'documents',
      },
    },
  },

  type: {
    title: 'Type Information',
    headerColorToken: 'type',
    cards: {
      identification: {
        title: 'Identification',
        colorToken: 'type',
        fields: [
          { label:'Name', aliases:['Name'], edit:'text' },
          { label:'Category', aliases:['Category'], edit:'lookup', lookupSource:'category' },
          { label:'Description', aliases:['Description'], edit:'text' },
          { label:'Asset Type', aliases:['AssetType', 'Asset Type'], edit:'text' },
          { label:'Created By', aliases:['CreatedBy', 'Created By'], edit:'lookup', lookupSource:'contact' },
        ],
      },
      manufacturer: {
        title: 'Manufacturer',
        colorToken: 'type',
        fields: [
          { label:'Manufacturer', aliases:['Manufacturer'], edit:'lookup', lookupSource:'contact' },
          { label:'Model No.', aliases:['ModelNumber', 'Model Number', 'ModelReference', 'Model Reference'], edit:'text' },
          { label:'Material', aliases:['Material'], edit:'text' },
          { label:'Size', aliases:['Size'], edit:'text' },
        ],
      },
      warranty: {
        title: 'Warranty',
        colorToken: 'type',
        fields: [
          { label:'Warranty (Parts)', aliases:['WarrantyGuarantorParts', 'Warranty Guarantor Parts'], edit:'lookup', lookupSource:'contact' },
          { label:'Warranty (Labour)', aliases:['WarrantyGuarantorLabor', 'Warranty Guarantor Labor', 'WarrantyGuarantorLabour', 'Warranty Guarantor Labour'], edit:'lookup', lookupSource:'contact' },
          { label:'Warranty Unit', aliases:['WarrantyDurationUnit', 'Warranty Duration Unit'], edit:'text' },
          { label:'Expected Life', aliases:['ExpectedLife', 'Expected Life'], edit:'text' },
        ],
      },
      associations: {
        title: 'Associations',
        colorToken: 'type',
        mode: 'associations',
        associations: [
          { key:'components', label:'Components', targetType:'component', cardinality:'many' },
        ],
      },
      attributes: {
        title: 'Additional Attributes',
        colorToken: 'type',
        mode: 'attributes',
      },
      documents: {
        title: 'Documents',
        colorToken: 'doccat',
        mode: 'documents',
      },
    },
  },

  system: {
    title: 'System Information',
    headerColorToken: 'system',
    cards: {
      identification: {
        title: 'Identification',
        colorToken: 'system',
        fields: [
          { label:'Name', aliases:['Name'], edit:'text' },
          { label:'Category', aliases:['Category'], edit:'lookup', lookupSource:'category' },
          { label:'Description', aliases:['Description'], edit:'text' },
          { label:'Created By', aliases:['CreatedBy', 'Created By'], edit:'lookup', lookupSource:'contact' },
        ],
      },
      associations: {
        title: 'Associations',
        colorToken: 'system',
        mode: 'associations',
        associations: [
          { key:'components', label:'Components', targetType:'component', cardinality:'many' },
        ],
      },
      attributes: {
        title: 'Additional Attributes',
        colorToken: 'system',
        mode: 'attributes',
      },
      documents: {
        title: 'Documents',
        colorToken: 'doccat',
        mode: 'documents',
      },
    },
  },

  component: {
    title: 'Component Information',
    headerColorToken: 'component',
    cards: {
      identification: {
        title: 'Identification',
        colorToken: 'component',
        fields: [
          { label:'Name', aliases:['Name'], edit:'text' },
          { label:'Description', aliases:['Description'], edit:'text' },
          { label:'Created By', aliases:['CreatedBy', 'Created By'], edit:'lookup', lookupSource:'contact' },
        ],
      },
      asset: {
        title: 'Asset',
        colorToken: 'component',
        fields: [
          { label:'Assembly Type', aliases:['AssemblyType', 'Assembly Type'], edit:'text' },
          { label:'Serial Number', aliases:['SerialNumber', 'Serial Number'], edit:'text' },
          { label:'Installation Date', aliases:['InstallationDate', 'Installation Date'], edit:'text' },
          { label:'Tag Number', aliases:['TagNumber', 'Tag Number'], edit:'text' },
        ],
      },
      associations: {
        title: 'Associations',
        colorToken: 'component',
        mode: 'associations',
        associations: [
          { key:'type', label:'Type', targetType:'type', cardinality:'one' },
          { key:'space', label:'Space', targetType:'space', cardinality:'one' },
          { key:'systems', label:'Systems', targetType:'system', cardinality:'many' },
        ],
      },
      attributes: {
        title: 'Additional Attributes',
        colorToken: 'component',
        mode: 'attributes',
      },
      documents: {
        title: 'Documents',
        colorToken: 'doccat',
        mode: 'documents',
      },
    },
  },

  contact: {
    title: 'Contact Information',
    headerColorToken: 'contact',
    cards: {
      identification: {
        title: 'Identification',
        colorToken: 'contact',
        fields: [
          { label:'Name / Unique ID', aliases:['Name'], edit:'text' },
          { label:'Given Name', aliases:['GivenName', 'Given Name'], edit:'text' },
          { label:'Family Name', aliases:['FamilyName', 'Family Name'], edit:'text' },
          { label:'Category', aliases:['Category'], edit:'text' },
          { label:'Created By', aliases:['CreatedBy', 'Created By'], edit:'lookup', lookupSource:'contact' },
        ],
      },
      communication: {
        title: 'Communication',
        colorToken: 'contact',
        fields: [
          { label:'Email', aliases:['Email'], edit:'text' },
          { label:'Phone', aliases:['Phone'], edit:'text' },
          { label:'Company / Organisation', aliases:['Company'], edit:'text' },
          { label:'Department', aliases:['Department'], edit:'text' },
          { label:'Organisation Code', aliases:['OrganizationCode', 'Organization Code'], edit:'text' },
          { label:'Town / City', aliases:['Town'], edit:'text' },
          { label:'Country', aliases:['Country'], edit:'text' },
        ],
      },
    },
  },

  document: {
    title: 'Document Information',
    headerColorToken: 'doccat',
    cards: {
      identification: {
        title: 'Identification',
        colorToken: 'doccat',
        fields: [
          { label:'Name', aliases:['Name'], edit:'text' },
          { label:'Description', aliases:['Description'], edit:'text' },
          { label:'Category', aliases:['Category'], edit:'lookup', lookupSource:'category' },
          { label:'Directory', aliases:['Directory'], edit:'text' },
          { label:'Created By', aliases:['CreatedBy', 'Created By'], edit:'lookup', lookupSource:'contact' },
        ],
      },
      associations: {
        title: 'Associations',
        colorToken: 'doccat',
        mode: 'associations',
        associations: [
          { key:'facilities', label:'Facilities', targetType:'facility', cardinality:'many' },
          { key:'floors', label:'Floors', targetType:'floor', cardinality:'many' },
          { key:'spaces', label:'Spaces', targetType:'space', cardinality:'many' },
          { key:'types', label:'Types', targetType:'type', cardinality:'many' },
          { key:'components', label:'Components', targetType:'component', cardinality:'many' },
          { key:'systems', label:'Systems', targetType:'system', cardinality:'many' },
        ],
      },
    },
  },
});
