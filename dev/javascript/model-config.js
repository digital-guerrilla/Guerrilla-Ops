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
          { label:'Created On', aliases:['CreatedOn', 'Created On'], edit:'text' },
        ],
      },
      project: {
        title: 'Project & Site',
        colorToken: 'facility',
        fields: [
          { label:'Project Name', aliases:['ProjectName', 'Project Name'], edit:'text' },
          { label:'Site Name', aliases:['SiteName', 'Site Name'], edit:'text' },
        ],
      },
      units: {
        title: 'Units & Measurement',
        colorToken: 'facility',
        fields: [
          { label:'Linear Units', aliases:['LinearUnits', 'Linear Units'], edit:'text' },
          { label:'Area Units', aliases:['AreaUnits', 'Area Units'], edit:'text' },
          { label:'Volume Units', aliases:['VolumeUnits', 'Volume Units'], edit:'text' },
          { label:'Currency', aliases:['Currency', 'CurrencyUnit', 'Currency Unit'], edit:'text' },
          { label:'Area Measurement', aliases:['AreaMeasurement', 'Area Measurement'], edit:'text' },
        ],
      },
      external: {
        title: 'External References',
        colorToken: 'facility',
        fields: [
          { label:'External System', aliases:['ExternalSystem', 'ExtSystem'], edit:'text' },
          { label:'External Project Object', aliases:['ExternalProjectObject', 'External Project Object'], edit:'text' },
          { label:'External Project Identifier', aliases:['ExternalProjectIdentifier', 'External Project Identifier'], edit:'text' },
          { label:'External Site Object', aliases:['ExternalSiteObject', 'External Site Object'], edit:'text' },
          { label:'External Site Identifier', aliases:['ExternalSiteIdentifier', 'External Site Identifier'], edit:'text' },
          { label:'External Facility Object', aliases:['ExternalFacilityObject', 'External Facility Object', 'ExternalObject', 'ExtObject'], edit:'text' },
          { label:'External Facility Identifier', aliases:['ExternalFacilityIdentifier', 'External Facility Identifier', 'ExternalIdentifier', 'ExtIdentifier'], edit:'text' },
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
          { label:'Created By', aliases:['CreatedBy', 'Created By'], edit:'lookup', lookupSource:'contact' },
          { label:'Created On', aliases:['CreatedOn', 'Created On'], edit:'text' },
        ],
      },
      geometry: {
        title: 'Geometry',
        colorToken: 'floor',
        fields: [
          { label:'Height', aliases:['Height'], edit:'text' },
          { label:'Elevation', aliases:['Elevation'], edit:'text' },
        ],
      },
      external: {
        title: 'External References',
        colorToken: 'floor',
        fields: [
          { label:'External System', aliases:['ExternalSystem', 'ExtSystem'], edit:'text' },
          { label:'External Object', aliases:['ExternalObject', 'ExtObject'], edit:'text' },
          { label:'External Identifier', aliases:['ExtIdentifier', 'ExternalIdentifier'], edit:'text' },
        ],
      },
      associations: {
        title: 'Associations',
        colorToken: 'floor',
        mode: 'associations',
        associations: [
          { key:'spaces', label:'Spaces', targetType:'space', cardinality:'many' },
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
          { label:'Created On', aliases:['CreatedOn', 'Created On'], edit:'text' },
        ],
      },
      measurements: {
        title: 'Measurements',
        colorToken: 'space',
        fields: [
          { label:'Gross Area', aliases:['GrossArea', 'Gross Area'], edit:'text' },
          { label:'Net Area', aliases:['NetArea', 'Net Area'], edit:'text' },
          { label:'Usable Height', aliases:['UsableHeight', 'Usable Height'], edit:'text' },
          { label:'Room Tag', aliases:['RoomTag', 'Room Tag'], edit:'text' },
        ],
      },
      external: {
        title: 'External References',
        colorToken: 'space',
        fields: [
          { label:'External System', aliases:['ExternalSystem', 'ExtSystem'], edit:'text' },
          { label:'External Object', aliases:['ExternalObject', 'ExtObject'], edit:'text' },
          { label:'External Identifier', aliases:['ExtIdentifier', 'ExternalIdentifier'], edit:'text' },
        ],
      },
      associations: {
        title: 'Associations',
        colorToken: 'space',
        mode: 'associations',
        associations: [
          { key:'floor', label:'Floor', targetType:'floor', cardinality:'one' },
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

  zone: {
    title: 'Zone Information',
    headerColorToken: 'space',
    cards: {
      identification: {
        title: 'Identification',
        colorToken: 'space',
        fields: [
          { label:'Name', aliases:['Name'], edit:'text' },
          { label:'Category', aliases:['Category'], edit:'lookup', lookupSource:'category' },
          { label:'Description', aliases:['Description'], edit:'text' },
          { label:'Space Names', aliases:['SpaceNames', 'Space Names'], edit:'text' },
        ],
      },
      audit: {
        title: 'Audit',
        colorToken: 'space',
        fields: [
          { label:'Created By', aliases:['CreatedBy', 'Created By'], edit:'lookup', lookupSource:'contact' },
          { label:'Created On', aliases:['CreatedOn', 'Created On'], edit:'text' },
        ],
      },
      external: {
        title: 'External References',
        colorToken: 'space',
        fields: [
          { label:'External System', aliases:['ExternalSystem', 'ExtSystem'], edit:'text' },
          { label:'External Object', aliases:['ExternalObject', 'ExtObject'], edit:'text' },
          { label:'External Identifier', aliases:['ExtIdentifier', 'ExternalIdentifier'], edit:'text' },
        ],
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
          { label:'Description', aliases:['Description'], edit:'text' },
          { label:'Category', aliases:['Category'], edit:'lookup', lookupSource:'category' },
          { label:'Asset Type', aliases:['AssetType', 'Asset Type'], edit:'text' },
        ],
      },
      audit: {
        title: 'Audit',
        colorToken: 'type',
        fields: [
          { label:'Created By', aliases:['CreatedBy', 'Created By'], edit:'lookup', lookupSource:'contact' },
          { label:'Created On', aliases:['CreatedOn', 'Created On'], edit:'text' },
        ],
      },
      manufacturer: {
        title: 'Manufacturer',
        colorToken: 'type',
        fields: [
          { label:'Manufacturer', aliases:['Manufacturer'], edit:'lookup', lookupSource:'contact' },
          { label:'Model Number', aliases:['ModelNumber', 'Model Number'], edit:'text' },
        ],
      },
      warranty: {
        title: 'Warranty',
        colorToken: 'type',
        fields: [
          { label:'Parts Guarantor', aliases:['WarrantyGuarantorParts', 'Warranty Guarantor Parts'], edit:'lookup', lookupSource:'contact' },
          { label:'Parts Duration', aliases:['WarrantyDurationParts', 'Warranty Duration Parts'], edit:'text' },
          { label:'Labour Guarantor', aliases:['WarrantyGuarantorLabor', 'Warranty Guarantor Labor'], edit:'lookup', lookupSource:'contact' },
          { label:'Labour Duration', aliases:['WarrantyDurationLabor', 'Warranty Duration Labor'], edit:'text' },
          { label:'Warranty Duration Unit', aliases:['WarrantyDurationUnit', 'Warranty Duration Unit'], edit:'text' },
          { label:'Replacement Cost', aliases:['ReplacementCost', 'Replacement Cost'], edit:'text' },
          { label:'Expected Life', aliases:['ExpectedLife', 'Expected Life'], edit:'text' },
          { label:'Duration Unit', aliases:['DurationUnit', 'Duration Unit'], edit:'text' },
          { label:'Warranty Description', aliases:['WarrantyDescription', 'Warranty Description'], edit:'text' },
        ],
      },
      dimensions: {
        title: 'Dimensions & Form',
        colorToken: 'type',
        fields: [
          { label:'Nominal Length', aliases:['NominalLength', 'Nominal Length'], edit:'text' },
          { label:'Nominal Width', aliases:['NominalWidth', 'Nominal Width'], edit:'text' },
          { label:'Nominal Height', aliases:['NominalHeight', 'Nominal Height'], edit:'text' },
          { label:'Shape', aliases:['Shape'], edit:'text' },
          { label:'Size', aliases:['Size'], edit:'text' },
        ],
      },
      specification: {
        title: 'Specification',
        colorToken: 'type',
        fields: [
          { label:'Model Reference', aliases:['ModelReference', 'Model Reference'], edit:'text' },
          { label:'Color', aliases:['Color', 'Colour'], edit:'text' },
          { label:'Finish', aliases:['Finish'], edit:'text' },
          { label:'Grade', aliases:['Grade'], edit:'text' },
          { label:'Material', aliases:['Material'], edit:'text' },
          { label:'Constituents', aliases:['Constituents'], edit:'text' },
          { label:'Features', aliases:['Features'], edit:'text' },
        ],
      },
      performance: {
        title: 'Performance',
        colorToken: 'type',
        fields: [
          { label:'Accessibility Performance', aliases:['AccessibilityPerformance', 'Accessibility Performance'], edit:'text' },
          { label:'Code Performance', aliases:['CodePerformance', 'Code Performance'], edit:'text' },
          { label:'Sustainability Performance', aliases:['SustainabilityPerformance', 'Sustainability Performance'], edit:'text' },
        ],
      },
      external: {
        title: 'External References',
        colorToken: 'type',
        fields: [
          { label:'External System', aliases:['ExternalSystem', 'ExtSystem'], edit:'text' },
          { label:'External Object', aliases:['ExternalObject', 'ExtObject'], edit:'text' },
          { label:'External Identifier', aliases:['ExtIdentifier', 'ExternalIdentifier'], edit:'text' },
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
        ],
      },
      audit: {
        title: 'Audit',
        colorToken: 'system',
        fields: [
          { label:'Created By', aliases:['CreatedBy', 'Created By'], edit:'lookup', lookupSource:'contact' },
          { label:'Created On', aliases:['CreatedOn', 'Created On'], edit:'text' },
        ],
      },
      external: {
        title: 'External References',
        colorToken: 'system',
        fields: [
          { label:'External System', aliases:['ExternalSystem', 'ExtSystem'], edit:'text' },
          { label:'External Object', aliases:['ExternalObject', 'ExtObject'], edit:'text' },
          { label:'External Identifier', aliases:['ExtIdentifier', 'ExternalIdentifier'], edit:'text' },
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
          { label:'Type', aliases:['TypeName', 'Type Name'], edit:'lookup', lookupSource:'type' },
          { label:'Space', aliases:['Space'], edit:'lookup', lookupSource:'space' },
        ],
      },
      audit: {
        title: 'Audit',
        colorToken: 'component',
        fields: [
          { label:'Created By', aliases:['CreatedBy', 'Created By'], edit:'lookup', lookupSource:'contact' },
          { label:'Created On', aliases:['CreatedOn', 'Created On'], edit:'text' },
        ],
      },
      asset: {
        title: 'Asset',
        colorToken: 'component',
        fields: [
          { label:'Serial Number', aliases:['SerialNumber', 'Serial Number'], edit:'text' },
          { label:'Installation Date', aliases:['InstallationDate', 'Installation Date'], edit:'text' },
          { label:'Warranty Start Date', aliases:['WarrantyStartDate', 'Warranty Start Date'], edit:'text' },
          { label:'Tag Number', aliases:['TagNumber', 'Tag Number'], edit:'text' },
          { label:'Bar Code', aliases:['BarCode', 'Bar Code', 'Barcode'], edit:'text' },
          { label:'Asset Identifier', aliases:['AssetIdentifier', 'Asset Identifier'], edit:'text' },
        ],
      },
      external: {
        title: 'External References',
        colorToken: 'component',
        fields: [
          { label:'External System', aliases:['ExternalSystem', 'ExtSystem'], edit:'text' },
          { label:'External Object', aliases:['ExternalObject', 'ExtObject'], edit:'text' },
          { label:'External Identifier', aliases:['ExtIdentifier', 'ExternalIdentifier'], edit:'text' },
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
          { label:'Email', aliases:['Email'], edit:'text' },
          { label:'Category', aliases:['Category'], edit:'text' },
          { label:'Given Name', aliases:['GivenName', 'Given Name'], edit:'text' },
          { label:'Family Name', aliases:['FamilyName', 'Family Name'], edit:'text' },
          { label:'Company / Organisation', aliases:['Company'], edit:'text' },
          { label:'Department', aliases:['Department'], edit:'text' },
          { label:'Organisation Code', aliases:['OrganizationCode', 'Organization Code'], edit:'text' },
        ],
      },
      audit: {
        title: 'Audit',
        colorToken: 'contact',
        fields: [
          { label:'Created By', aliases:['CreatedBy', 'Created By'], edit:'lookup', lookupSource:'contact' },
          { label:'Created On', aliases:['CreatedOn', 'Created On'], edit:'text' },
        ],
      },
      communication: {
        title: 'Communication',
        colorToken: 'contact',
        fields: [
          { label:'Phone', aliases:['Phone'], edit:'text' },
        ],
      },
      address: {
        title: 'Address',
        colorToken: 'contact',
        fields: [
          { label:'Street', aliases:['Street'], edit:'text' },
          { label:'Postal Box', aliases:['PostalBox', 'Postal Box'], edit:'text' },
          { label:'Town / City', aliases:['Town'], edit:'text' },
          { label:'State / Region', aliases:['StateRegion', 'State Region'], edit:'text' },
          { label:'Postal Code', aliases:['PostalCode', 'Postal Code'], edit:'text' },
          { label:'Country', aliases:['Country'], edit:'text' },
        ],
      },
      external: {
        title: 'External References',
        colorToken: 'contact',
        fields: [
          { label:'External System', aliases:['ExternalSystem', 'ExtSystem'], edit:'text' },
          { label:'External Object', aliases:['ExternalObject', 'ExtObject'], edit:'text' },
          { label:'External Identifier', aliases:['ExternalIdentifier', 'ExtIdentifier'], edit:'text' },
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
