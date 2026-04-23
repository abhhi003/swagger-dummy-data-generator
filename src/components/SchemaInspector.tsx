import React, { useState } from 'react';
import { ChevronDown, ChevronRight, FileX } from 'lucide-react';

const GENERATOR_TYPES = [
  '',
  'Email Address',
  'Full Name',
  'First Name',
  'Last Name',
  'Phone Number',
  'UUID v4',
  'Date (ISO 8601)',
  'Past Date',
  'Future Date',
  'Street Address',
  'City',
  'Country',
  'Zip Code',
  'Company Name',
  'Job Title',
  'URL',
  'IP Address',
  'Credit Card Number',
  'Random Integer',
  'Random Float',
  'Boolean',
  'Lorem Ipsum Paragraph'
];

interface SchemaNodeProps {
  name: string;
  node: any;
  path: string;
  required: boolean;
  mappings: Record<string, string>;
  onMapChange: (path: string, val: string) => void;
  depth: number;
}

const SchemaNode: React.FC<SchemaNodeProps> = ({ name, node, path, required, mappings, onMapChange, depth }) => {
  const [expanded, setExpanded] = useState(depth < 2); // Auto-expand up to depth 2

  const isObject = node && typeof node === 'object' && !Array.isArray(node);
  const nodeType = node?.type || (Array.isArray(node) ? 'array' : typeof node);
  const items = node?.items;
  const isRequired = required;

  let childrenEntries: [string, any][] = [];
  if (isObject && node.properties) {
    childrenEntries = Object.entries(node.properties);
  } else if (isObject && !node.type) {
    // Fallback for raw JSON objects instead of JSON Schema
    childrenEntries = Object.entries(node);
  }

  const hasChildren = childrenEntries.length > 0 || !!items;

  // Render format or specific type hint if available
  const formatHint = node?.format || (node?.enum ? 'enum' : null);

  return (
    <div className="font-sans" style={{ paddingLeft: depth === 0 ? 0 : 12 }}>
      <div className={`flex items-center gap-2 py-1.5 border-b transition-colors group pr-2 pl-1 my-px rounded-r ${
        isRequired 
          ? 'bg-red-50/30 dark:bg-red-900/10 border-red-100 dark:border-red-900/30 hover:bg-red-50/60 dark:hover:bg-red-900/20 border-l-2 border-l-red-400 dark:border-l-red-500' 
          : 'border-gray-100 dark:border-white/5 hover:bg-gray-50 dark:hover:bg-[#1a1a1a] border-l-2 border-l-transparent'
      }`}>
        {/* Expand/Collapse Toggle */}
        {hasChildren ? (
          <button 
            onClick={() => setExpanded(!expanded)} 
            className="p-0.5 text-gray-500 hover:text-black rounded hover:bg-gray-200 focus:outline-none shrink-0"
          >
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        ) : (
          <div style={{ width: 18 }} className="shrink-0" />
        )}

        {/* Field Name */}
        <span className="font-mono text-[11px] font-bold text-[#141414] dark:text-[#f0f0f0] truncate max-w-[200px]" title={name}>
          {name || (depth === 0 ? '{ ROOT SCHEMA }' : '')}
        </span>

        {/* Required Badge */}
        {isRequired && (
          <span className="text-[8px] font-bold uppercase px-1 py-0.5 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded shrink-0">
            Req
          </span>
        )}

        {/* Type / Format Badge */}
        {nodeType && (
          <span className="text-[10px] text-gray-500 dark:text-gray-400 italic shrink-0">
            {nodeType}{formatHint ? `<${formatHint}>` : ''}
          </span>
        )}

        {/* Default Value */}
        {node?.default !== undefined && (
          <span className="text-[10px] text-blue-500 dark:text-blue-400 shrink-0 truncate max-w-[100px]" title={String(node.default)}>
            (def: {String(node.default)})
          </span>
        )}

        {/* Spacer */}
        <div className="flex-1 min-w-[20px]" />

        {/* Manual Data Mapper Dropdown */}
        {(!hasChildren || nodeType === 'array') && (
          <div className="opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
            <select
              value={mappings[path] || ''}
              onChange={(e) => onMapChange(path, e.target.value)}
              className={`text-[10px] border rounded px-1.5 py-1 w-32 focus:outline-none transition-colors ${
                mappings[path] ? 'border-blue-400 bg-blue-50 text-blue-800 dark:border-blue-500 dark:bg-blue-900/30 dark:text-blue-300' : 'border-gray-200 bg-white text-gray-600 hover:border-gray-400 dark:bg-[#1a1a1a] dark:text-gray-300 dark:border-gray-600 dark:hover:border-gray-400'
              }`}
            >
              <option value="">-- AI Engine Auto --</option>
              {GENERATOR_TYPES.filter(t => t).map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Recursive Children Processing */}
      {expanded && (
        <div className="mt-0.5 mb-1">
          {items && (
            <SchemaNode
              name="[ array items ]"
              node={items}
              path={`${path}[]`}
              required={false}
              mappings={mappings}
              onMapChange={onMapChange}
              depth={depth + 1}
            />
          )}
          {childrenEntries.map(([childName, childNode]) => (
            <SchemaNode
              key={childName}
              name={childName}
              node={childNode}
              path={`${path}.${childName}`}
              required={Array.isArray(node?.required) ? node.required.includes(childName) : false}
              mappings={mappings}
              onMapChange={onMapChange}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
};

interface SchemaInspectorProps {
  parsedSchema: any;
  mappings: Record<string, string>;
  onMapChange: (path: string, val: string) => void;
}

export default function SchemaInspector({ parsedSchema, mappings, onMapChange }: SchemaInspectorProps) {
  if (!parsedSchema) {
    return (
      <div className="flex flex-col items-center justify-center p-10 h-56 border border-dashed border-[#D1D1CF] dark:border-[#333] rounded bg-[#F8F8F7] dark:bg-[#1c1c1c] text-gray-400 dark:text-gray-500 transition-colors">
        <FileX className="w-8 h-8 mb-3 opacity-50" />
        <p className="text-[11px] font-medium text-center max-w-xs">
          A valid JSON or YAML schema is required to visualize the structure and explicitly map datatypes.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-[#141414] border border-[#D1D1CF] dark:border-[#333] rounded p-3 h-56 overflow-y-auto overflow-x-hidden shadow-inner custom-scrollbar transition-colors">
      <SchemaNode
        name=""
        node={parsedSchema}
        path="root"
        required={true}
        mappings={mappings}
        onMapChange={onMapChange}
        depth={0}
      />
    </div>
  );
}
