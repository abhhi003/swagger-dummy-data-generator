import { useState, useEffect, useMemo, useRef } from 'react';
import { generateDummyData, validateGeneratedData, fixGeneratedData } from './services/ai';
import { Download, Play, Trash2, Copy, FileJson, Settings2, Code2, Check, Save, AlertTriangle, Undo2, Redo2, Search, ArrowUp, ArrowDown, Wrench, Moon, Sun, X } from 'lucide-react';
import yaml from 'js-yaml';
import SchemaInspector from './components/SchemaInspector';
import { Toaster, toast, ToastBar } from 'react-hot-toast';

interface SavedConfig {
  id: string;
  name: string;
  schema: string;
  endpoint: string;
  rootCount: number;
  arrayMin: number;
  arrayMax: number;
  uniqueArrays: boolean;
  customRules: string;
  fieldMappings: Record<string, string>;
  timestamp: number;
}

interface ConfigState {
  schema: string;
  endpoint: string;
  rootCount: number;
  arrayMin: number;
  arrayMax: number;
  uniqueArrays: boolean;
  customRules: string;
  fieldMappings: Record<string, string>;
}

const initialConfig: ConfigState = {
  schema: '',
  endpoint: '',
  rootCount: 1,
  arrayMin: 1,
  arrayMax: 5,
  uniqueArrays: false,
  customRules: '',
  fieldMappings: {}
};

export default function App() {
  // Config History State
  const [past, setPast] = useState<ConfigState[]>([]);
  const [present, setPresent] = useState<ConfigState>(initialConfig);
  const [future, setFuture] = useState<ConfigState[]>([]);
  const [local, setLocal] = useState<ConfigState>(initialConfig);

  // Tabs for Editor vs Visual Inspector
  const [activeTab, setActiveTab] = useState<'raw' | 'inspector'>('raw');

  // Status & Outputs
  const [output, setOutput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [savedCopied, setSavedCopied] = useState(false);
  const [savedConfigs, setSavedConfigs] = useState<SavedConfig[]>([]);

  // Validation States
  const [validationErrors, setValidationErrors] = useState<string[] | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [isFixing, setIsFixing] = useState(false);

  // Auto-detected endpoints
  const [availableEndpoints, setAvailableEndpoints] = useState<string[]>([]);

  // Dark Mode State
  const [isDarkMode, setIsDarkMode] = useState(() => {
    const saved = localStorage.getItem('dataGenie_theme');
    if (saved) return saved === 'dark';
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  useEffect(() => {
    localStorage.setItem('dataGenie_theme', isDarkMode ? 'dark' : 'light');
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);

  // Search in Schema State
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMatches, setSearchMatches] = useState<number[]>([]);
  const [currentMatch, setCurrentMatch] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Debounced History Push
  useEffect(() => {
    const timer = setTimeout(() => {
      if (JSON.stringify(local) !== JSON.stringify(present)) {
        setPast(p => [...p, present].slice(-50)); // keep last 50 edits
        setPresent(local);
        setFuture([]); // clear redo stack on new action
      }
    }, 800);
    return () => clearTimeout(timer);
  }, [local, present]);

  const updateLocal = (changes: Partial<ConfigState>) => {
    setLocal(prev => ({ ...prev, ...changes }));
  };

  const handleMapChange = (path: string, val: string) => {
    setLocal(prev => ({
      ...prev,
      fieldMappings: {
        ...prev.fieldMappings,
        [path]: val
      }
    }));
  };

  const undo = () => {
    if (past.length === 0) return;
    const prev = past[past.length - 1];
    setPast(p => p.slice(0, p.length - 1));
    setFuture(f => [present, ...f]);
    setPresent(prev);
    setLocal(prev);
  };

  const redo = () => {
    if (future.length === 0) return;
    const next = future[0];
    setFuture(f => f.slice(1));
    setPast(p => [...p, present]);
    setPresent(next);
    setLocal(next);
  };

  // Load configs on mount
  useEffect(() => {
    const loaded = localStorage.getItem('dataGenie_configs');
    if (loaded) {
      try {
        setSavedConfigs(JSON.parse(loaded));
      } catch (e) {
        console.error('Failed to parse saved configs', e);
      }
    }
  }, []);

  // Format validation and auto-detection
  const schemaStatus = useMemo(() => {
    if (!local.schema.trim()) return { type: 'empty', valid: false, message: 'Awaiting schema...', parsed: null };
    try {
      const parsed = JSON.parse(local.schema);
      return { type: 'JSON', valid: true, message: 'Valid JSON', parsed };
    } catch (eJSON) {
      try {
        const parsed = yaml.load(local.schema);
        return { type: 'YAML', valid: true, message: 'Valid YAML', parsed };
      } catch (eYAML: any) {
        const lines = eYAML.message?.split('\n') || ['Invalid format'];
        return { type: 'invalid', valid: false, message: lines[0], parsed: null };
      }
    }
  }, [local.schema]);

  const lastAnalyzedSchemaRef = useRef<string>('');

  useEffect(() => {
    if (schemaStatus.parsed && local.schema !== lastAnalyzedSchemaRef.current) {
      lastAnalyzedSchemaRef.current = local.schema;
      
      const parsed = schemaStatus.parsed as any;
      let foundEndpoints: string[] = [];
      let bestMatch = "";
      
      if (parsed?.openapi || parsed?.swagger) {
        const paths = parsed.paths;
        if (paths && typeof paths === 'object') {
          for (const pathKey of Object.keys(paths)) {
            const methods = paths[pathKey];
            if (!methods || typeof methods !== 'object') continue;
            
            for (const methodKey of ['post', 'put', 'patch', 'delete', 'get']) {
              const operation = methods[methodKey];
              if (operation && typeof operation === 'object') {
                const epName = `${methodKey.toUpperCase()} ${pathKey}`;
                foundEndpoints.push(epName);
                
                if (!bestMatch) {
                  const hasRequestBody = !!operation.requestBody || !!operation.request_body;
                  const hasBodyParam = Array.isArray(operation.parameters) && operation.parameters.some((p: any) => p.in === 'body');
                  if (hasRequestBody || hasBodyParam) {
                    bestMatch = epName;
                  }
                }
              }
            }
          }
        }
      }
      
      setAvailableEndpoints(foundEndpoints);

      if (!local.endpoint.trim() && foundEndpoints.length > 0) {
        updateLocal({ endpoint: bestMatch || foundEndpoints[0] });
      }
    }
  }, [schemaStatus.parsed, local.schema]);

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    const query = e.target.value;
    setSearchQuery(query);
    if (!query) {
      setSearchMatches([]);
      return;
    }
    
    const text = local.schema;
    const matches = [];
    let idx = text.toLowerCase().indexOf(query.toLowerCase());
    while (idx !== -1) {
      matches.push(idx);
      idx = text.toLowerCase().indexOf(query.toLowerCase(), idx + query.length);
    }
    setSearchMatches(matches);
    if (matches.length > 0) {
      setCurrentMatch(0);
      scrollToMatch(0, matches, query.length, false);
    }
  };

  const handleNextMatch = () => {
    if (searchMatches.length === 0) return;
    const next = (currentMatch + 1) % searchMatches.length;
    setCurrentMatch(next);
    scrollToMatch(next, searchMatches, searchQuery.length, true);
  };

  const handlePrevMatch = () => {
    if (searchMatches.length === 0) return;
    const prev = (currentMatch - 1 + searchMatches.length) % searchMatches.length;
    setCurrentMatch(prev);
    scrollToMatch(prev, searchMatches, searchQuery.length, true);
  };

  const scrollToMatch = (matchIdx: number, matches: number[], len: number, shouldFocus: boolean = false) => {
    const txtArea = textareaRef.current;
    if (!txtArea) return;
    const start = matches[matchIdx];
    
    // Always set the selection range
    txtArea.setSelectionRange(start, start + len);

    // Use a hidden clone to let the browser natively calculate the exact pixel height
    // This perfectly handles all word-wrapping, variable fonts, font tracking, and line heights
    const clone = document.createElement('textarea');
    clone.className = txtArea.className;
    clone.style.position = 'absolute';
    clone.style.left = '-9999px';
    clone.style.visibility = 'hidden';
    clone.style.width = txtArea.clientWidth + 'px';
    clone.style.height = '1px';
    clone.style.minHeight = '0';
    clone.style.maxHeight = 'none';
    
    // Apply the exact substring up to our cursor to measure its native rendering height
    clone.value = local.schema.substring(0, start);
    
    document.body.appendChild(clone);
    const pixelOffset = clone.scrollHeight;
    document.body.removeChild(clone);
    
    // Center the match dynamically inside the visible bounding box of the textarea
    txtArea.scrollTop = Math.max(0, pixelOffset - (txtArea.clientHeight / 2));

    if (shouldFocus) {
      // Focus the text area for interaction if explicitly requested via arrows
      txtArea.focus();
    }
  };

  const handleGenerate = async () => {
    if (!local.schema.trim()) {
      toast.error('Please provide a Swagger definition or JSON/YAML schema.');
      return;
    }

    if (!schemaStatus.valid) {
      toast.error(`Schema validation failed: ${schemaStatus.message}. Please fix the syntax before generating.`);
      return;
    }
    
    setValidationErrors(null);
    setIsGenerating(true);
    let finalJsonStr = '';
    
    try {
      const result = await generateDummyData(local);

      // AI might return markdown backticks. Strip them.
      let cleanResult = result.trim();
      cleanResult = cleanResult.replace(/^```json\n?|^```\n?/i, '').replace(/\n?```$/i, '').trim();

      try {
        const parsed = JSON.parse(cleanResult);
        finalJsonStr = JSON.stringify(parsed, null, 2);
        setOutput(finalJsonStr);
      } catch (e: any) {
        // We failed to parse the AI's output
        toast.error(`Warning: AI returned malformed JSON. Previewing raw string. (Parser context: ${e.message})`, { duration: 6000 });
        finalJsonStr = cleanResult;
        setOutput(finalJsonStr);
      }
    } catch (err: any) {
      // Enhanced AI error parsing
      let userFriendlyError = err.message || 'An error occurred while generating data.';
      const msgLower = userFriendlyError.toLowerCase();
      
      if (msgLower.includes('429') || msgLower.includes('quota') || msgLower.includes('exhausted')) {
        userFriendlyError = 'API Quota Exceeded: The system is rate-limited or out of credits. Please try again later.';
      } else if (msgLower.includes('400') || msgLower.includes('invalid format')) {
        userFriendlyError = 'Bad Request: The schema or configuration might be too large or complex for the model to process.';
      } else if (msgLower.includes('500') || msgLower.includes('503')) {
        userFriendlyError = 'Service Unavailable: The AI backend is temporarily down. Please try again shortly.';
      } else if (msgLower.includes('safety') || msgLower.includes('blocked')) {
        userFriendlyError = 'Content Blocked: The AI model blocked the generation due to safety constraints. Please modify your schema topics.';
      }
      
      toast.error(userFriendlyError, { duration: 6000 });
      setIsGenerating(false);
      return; // Stop here if generation failed
    }
    
    // Step 2: Validate the Output
    setIsValidating(true);
    setIsGenerating(false);
    
    try {
       const discrepancies = await validateGeneratedData({
         schema: local.schema,
         endpoint: local.endpoint,
         generatedData: finalJsonStr
       });
       
       if (discrepancies && discrepancies.length > 0) {
         setValidationErrors(discrepancies);
         toast.error(`Found ${discrepancies.length} validation issues. AI is auto-fixing...`, { icon: '🤖', duration: 4000 });
         
         // Seamlessly trigger automatic fix workflow without user input
         await performAutoFix(finalJsonStr, discrepancies);
       } else {
         setValidationErrors(null);
         toast.success("Generated data passed all validation checks!");
       }
    } catch (err: any) {
       console.error("AI Validation Failed", err);
       const errMsg = String(err?.message || err);
       if (errMsg.toLowerCase().includes('429') || errMsg.toLowerCase().includes('quota') || errMsg.toLowerCase().includes('exhausted')) {
         toast.error("Validation Skipped: API Quota Exceeded for AI Model.", { duration: 6000 });
         setValidationErrors(["Validation failed: API Quota Exceeded."]);
       } else {
         setValidationErrors(["Could not validate data against schema (Internal Validation API Failed)."]);
       }
    } finally {
       setIsValidating(false);
    }
  };

  const performAutoFix = async (currentData: string, currentErrors: string[]) => {
    setIsFixing(true);
    setIsValidating(false);
    let tempJsonStr = '';

    try {
      const result = await fixGeneratedData({
        schema: local.schema,
        endpoint: local.endpoint,
        generatedData: currentData,
        validationErrors: currentErrors
      });

      let cleanResult = result.trim();
      cleanResult = cleanResult.replace(/^```json\n?|^```\n?/i, '').replace(/\n?```$/i, '').trim();

      try {
        const parsed = JSON.parse(cleanResult);
        tempJsonStr = JSON.stringify(parsed, null, 2);
        setOutput(tempJsonStr);
        toast.success("Auto-fix applied successfully!");
      } catch (e: any) {
        toast.error(`Warning: AI returned malformed JSON during auto-fix. Previewing raw string.`, { duration: 6000 });
        tempJsonStr = cleanResult;
        setOutput(tempJsonStr);
      }
    } catch (err: any) {
      const errMsg = String(err?.message || 'Unknown error');
      if (errMsg.toLowerCase().includes('429') || errMsg.toLowerCase().includes('quota') || errMsg.toLowerCase().includes('exhausted')) {
        toast.error("Auto-fix Skipped: API Quota Exceeded.", { duration: 6000 });
      } else {
        toast.error(`Auto-fix failed: ${errMsg}`, { duration: 6000 });
      }
      setIsFixing(false);
      return;
    }

    // Re-validate after fixing
    setIsValidating(true);
    setIsFixing(false);
    
    try {
       const finalDiscrepancies = await validateGeneratedData({
         schema: local.schema,
         endpoint: local.endpoint,
         generatedData: tempJsonStr
       });
       setValidationErrors(finalDiscrepancies);
       if (finalDiscrepancies && finalDiscrepancies.length > 0) {
         toast.error(`${finalDiscrepancies.length} validation issues remain after fix.`, { icon: '⚠️', duration: 6000 });
       }
    } catch (err: any) {
       console.error("AI Validation Failed", err);
       const errMsg = String(err?.message || err);
       if (errMsg.toLowerCase().includes('429') || errMsg.toLowerCase().includes('quota') || errMsg.toLowerCase().includes('exhausted')) {
         toast.error("Re-validation Skipped: API Quota Exceeded.", { duration: 6000 });
         setValidationErrors(["Re-validation failed: API Quota Exceeded."]);
       } else {
         setValidationErrors(["Could not re-validate fixed data."]);
       }
    } finally {
       setIsValidating(false);
    }
  };

  const handleAutoFix = async () => {
    if (!output || !validationErrors || validationErrors.length === 0) return;
    await performAutoFix(output, validationErrors);
  };

  const handleClear = () => {
    setLocal(initialConfig);
    setPast([]);
    setFuture([]);
    setPresent(initialConfig);
    
    setOutput('');
    setValidationErrors(null);
    setSearchQuery('');
    setSearchMatches([]);
  };

  const handleCopy = async () => {
    if (!output) return;
    try {
      await navigator.clipboard.writeText(output);
      setCopied(true);
      toast.success("JSON copied to clipboard!");
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy', err);
      toast.error('Failed to copy to clipboard');
    }
  };

  const handleExport = () => {
    if (!output) return;
    const blob = new Blob([output], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dummy-data-${new Date().getTime()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleSaveConfig = () => {
    if (!local.schema.trim()) return;
    
    // Generate a sleek name format based on endpoint or timestamp
    const baseName = local.endpoint.trim() ? local.endpoint.split(' ')[1] || local.endpoint : 'Saved Schema';
    const name = `${baseName} - ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
    
    const newConfig: SavedConfig = {
      id: Date.now().toString(),
      name,
      ...local,
      timestamp: Date.now()
    };
    
    const updated = [newConfig, ...savedConfigs].slice(0, 20); // Keep max 20
    setSavedConfigs(updated);
    localStorage.setItem('dataGenie_configs', JSON.stringify(updated));
    
    setSavedCopied(true);
    toast.success("Configuration saved successfully!");
    setTimeout(() => setSavedCopied(false), 2000);
  };

  const handleLoadConfig = (id: string) => {
    const config = savedConfigs.find(c => c.id === id);
    if (config) {
      const parsedConfig: ConfigState = {
        schema: config.schema,
        endpoint: config.endpoint,
        rootCount: config.rootCount,
        arrayMin: config.arrayMin !== undefined ? config.arrayMin : (config as any).arrayLength || 1, // Fallback for legacy configs
        arrayMax: config.arrayMax !== undefined ? config.arrayMax : (config as any).arrayLength || 5,
        uniqueArrays: config.uniqueArrays || false,
        customRules: config.customRules,
        fieldMappings: config.fieldMappings || {}
      };
      
      setPast(p => [...p, present]);
      setFuture([]);
      setPresent(parsedConfig);
      setLocal(parsedConfig);
      
      setOutput('');
      setValidationErrors(null);
      
      toast.success(`Loaded "${config.name}"`);
    }
  };

  return (
    <div className="h-screen w-full bg-[#F1F1F0] dark:bg-[#0a0a0a] text-[#141414] dark:text-[#f0f0f0] font-sans flex flex-col overflow-hidden transition-colors">
      <Toaster position="bottom-right" toastOptions={{ 
        success: { duration: 3000 },
        error: { duration: 5000 },
        style: {
          background: isDarkMode ? '#1c1c1c' : '#ffffff',
          color: isDarkMode ? '#f0f0f0' : '#141414',
          border: isDarkMode ? '1px solid #333' : '1px solid #E4E4E2',
        }
      }}>
        {(t) => (
          <ToastBar toast={t}>
            {({ icon, message }) => (
              <div className="flex items-start gap-2 max-w-[350px] py-1">
                <div className="shrink-0 flex items-center justify-center mt-0.5">{icon}</div>
                <div className="flex-1 pr-2 whitespace-pre-wrap text-sm leading-relaxed">{message}</div>
                <button 
                  onClick={() => toast.dismiss(t.id)} 
                  className="p-1 hover:bg-gray-100 dark:hover:bg-[#333] rounded transition-colors shrink-0 mt-0.5"
                >
                  <X className="w-4 h-4 opacity-50 hover:opacity-100 transition-opacity" />
                </button>
              </div>
            )}
          </ToastBar>
        )}
      </Toaster>
      {/* Top Navigation Bar */}
      <header className="h-14 border-b border-[#D1D1CF] dark:border-[#333] bg-white dark:bg-[#141414] flex items-center justify-between px-6 shrink-0 z-10 transition-colors">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-[#141414] dark:bg-[#f0f0f0] rounded flex items-center justify-center transition-colors">
             <div className="w-4 h-4 border-2 border-white dark:border-[#141414] rotate-45 transition-colors"></div>
          </div>
          <span className="font-bold text-lg tracking-tight">DATA GENIE</span>
          <span className="px-2 py-0.5 bg-[#E4E4E2] dark:bg-[#2a2a2a] text-[10px] font-bold rounded uppercase ml-2 transition-colors">v2.3.0</span>
        </div>
        <div className="flex items-center">
          {/* Theme Toggle */}
          <button
            onClick={() => setIsDarkMode(!isDarkMode)}
            className="p-1.5 mr-4 text-[#888] dark:text-[#a0a0a0] hover:bg-gray-100 dark:hover:bg-[#2a2a2a] rounded transition-colors"
            title="Toggle Dark Mode"
          >
            {isDarkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>

          {/* Load Config Select in Navbar */}
          {savedConfigs.length > 0 && (
            <div className="mr-0.5">
              <select 
                className="bg-transparent border border-[#D1D1CF] dark:border-[#333] text-[10px] py-1.5 px-2 rounded font-bold uppercase tracking-widest text-[#555] dark:text-[#a0a0a0] focus:outline-none focus:border-[#141414] dark:focus:border-[#888] dark:bg-[#1c1c1c] transition-colors"
                onChange={(e) => handleLoadConfig(e.target.value)}
                value=""
              >
                <option value="" disabled>LOAD PREVIOUS...</option>
                {savedConfigs.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Undo Redo Controls */}
          <div className="flex items-center gap-1 mr-4 border-l border-[#D1D1CF] dark:border-[#333] pl-2 border-r pr-4">
            <button
              onClick={undo}
              disabled={past.length === 0}
              className="p-1.5 text-[#888] dark:text-[#a0a0a0] disabled:opacity-30 hover:bg-gray-100 dark:hover:bg-[#2a2a2a] rounded transition-colors"
              title="Undo Config Change"
            >
               <Undo2 className="w-4 h-4" />
            </button>
            <button
              onClick={redo}
              disabled={future.length === 0}
              className="p-1.5 text-[#888] dark:text-[#a0a0a0] disabled:opacity-30 hover:bg-gray-100 dark:hover:bg-[#2a2a2a] rounded transition-colors"
              title="Redo Config Change"
            >
               <Redo2 className="w-4 h-4" />
            </button>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleClear}
              disabled={isGenerating || isValidating}
              className="px-4 py-1.5 border border-[#D1D1CF] dark:border-[#333] rounded-md text-sm font-medium hover:bg-gray-50 dark:hover:bg-[#2a2a2a] transition-colors flex items-center gap-2 disabled:opacity-50"
            >
              <Trash2 className="w-4 h-4 text-[#888] dark:text-[#a0a0a0]" />
              Clear
            </button>
            <button
              onClick={handleSaveConfig}
              disabled={!local.schema.trim()}
              className="px-4 py-1.5 border border-[#D1D1CF] dark:border-[#333] rounded-md text-sm font-medium hover:bg-gray-50 dark:hover:bg-[#2a2a2a] transition-colors flex items-center gap-2 disabled:opacity-50"
            >
              {savedCopied ? <Check className="w-4 h-4 text-green-600 dark:text-green-400" /> : <Save className="w-4 h-4 text-[#888] dark:text-[#a0a0a0]" />}
              {savedCopied ? 'Saved!' : 'Save Config'}
            </button>
            <div className="w-px h-6 bg-[#D1D1CF] dark:bg-[#333] mx-1 transition-colors"></div>
            <button
              onClick={handleGenerate}
              disabled={isGenerating || isValidating}
              className="px-4 py-1.5 bg-[#141414] dark:bg-[#f0f0f0] text-white dark:text-[#141414] rounded-md text-sm font-medium hover:bg-black dark:hover:bg-white transition-colors flex items-center gap-2 disabled:opacity-70 min-w-[150px] justify-center"
            >
              {isGenerating || isValidating ? (
                <svg className="animate-spin h-4 w-4 text-current" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              ) : (
                <Play className="w-4 h-4 fill-current" />
              )}
              {isGenerating ? 'Generating...' : isValidating ? 'Validating...' : 'Generate Body'}
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Workspace */}
      <main className="flex-1 flex overflow-hidden">
        
        {/* Left Panel - Configuration */}
        <section className="w-1/2 flex flex-col border-r border-[#D1D1CF] dark:border-[#333] min-w-0 bg-[#F8F8F7] dark:bg-[#0a0a0a] transition-colors">
          
          <div className="flex-1 overflow-y-auto custom-scrollbar-panel">
            {/* Input Section 1: Schema Box / Tab */}
            <div className="border-b border-[#D1D1CF] dark:border-[#333] bg-white dark:bg-[#141414] transition-colors">
              <div className="p-4 border-b border-[#D1D1CF] dark:border-[#333] bg-[#F8F8F7] dark:bg-[#1c1c1c] flex justify-between items-center transition-colors">
                
                <div className="flex items-center gap-4">
                  <h2 className="text-[11px] font-bold text-[#888] dark:text-[#a0a0a0] uppercase tracking-widest flex items-center gap-2">
                    <Code2 className="w-4 h-4" />
                    API Schema
                  </h2>

                  {/* Tabs Toggle */}
                  <div className="flex bg-[#E4E4E2] dark:bg-[#2a2a2a] p-0.5 rounded ml-2 transition-colors">
                    <button
                      onClick={() => setActiveTab('raw')}
                      className={`px-3 py-1 text-[10px] font-bold uppercase rounded transition-colors ${activeTab === 'raw' ? 'bg-white dark:bg-[#444] shadow-sm text-black dark:text-white' : 'text-[#888] dark:text-[#999] hover:text-black dark:hover:text-white'}`}
                    >
                      Raw Editor
                    </button>
                    <button
                      onClick={() => setActiveTab('inspector')}
                      className={`px-3 py-1 text-[10px] font-bold uppercase rounded transition-colors ${activeTab === 'inspector' ? 'bg-white dark:bg-[#444] shadow-sm text-black dark:text-white' : 'text-[#888] dark:text-[#999] hover:text-black dark:hover:text-white'}`}
                    >
                      Visual Inspector
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  
                  {/* Find Toolbar (only on raw) */}
                  {activeTab === 'raw' && (
                    <div className="flex items-center bg-white dark:bg-[#141414] border border-[#D1D1CF] dark:border-[#333] rounded text-xs focus-within:border-[#141414] dark:focus-within:border-[#888] transition-colors">
                       <Search className="w-3 h-3 text-[#888] dark:text-[#a0a0a0] ml-2 shrink-0" />
                       <input 
                         type="text" 
                         ref={searchInputRef}
                         placeholder="Find in schema..." 
                         value={searchQuery}
                         onChange={handleSearch}
                         onKeyDown={(e) => {
                           if (e.key === 'Enter') {
                             e.preventDefault();
                             handleNextMatch();
                           }
                         }}
                         className="bg-transparent border-none focus:outline-none focus:ring-0 px-2 py-1 w-32 dark:text-[#f0f0f0] dark:placeholder-[#666]"
                       />
                       {searchMatches.length > 0 && (
                          <div className="flex items-center gap-1 text-[#888] dark:text-[#a0a0a0] text-[10px] px-2 font-mono border-l border-[#E4E4E2] dark:border-[#333] py-1 bg-[#F8F8F7] dark:bg-[#1c1c1c]">
                             <span>{currentMatch + 1}/{searchMatches.length}</span>
                             <button onClick={handlePrevMatch} className="hover:text-black dark:hover:text-white p-0.5 rounded hover:bg-[#E4E4E2] dark:hover:bg-[#333]"><ArrowUp className="w-3 h-3" /></button>
                             <button onClick={handleNextMatch} className="hover:text-black dark:hover:text-white p-0.5 rounded hover:bg-[#E4E4E2] dark:hover:bg-[#333]"><ArrowDown className="w-3 h-3" /></button>
                          </div>
                       )}
                    </div>
                  )}
                </div>
              </div>
              <div className="p-5 space-y-4 bg-white dark:bg-[#141414] min-h-[290px] transition-colors">
                
                {activeTab === 'raw' ? (
                  <div>
                    <div className="flex justify-between items-end mb-2">
                      <label htmlFor="schema" className="block text-xs font-bold text-[#888] uppercase tracking-wider">
                        Swagger / OpenAPI Definition <span className="text-red-500">*</span>
                      </label>
                      <span className={`text-[10px] font-mono font-bold uppercase px-2 py-0.5 rounded ${
                          schemaStatus.type === 'JSON' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' :
                          schemaStatus.type === 'YAML' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400' :
                          schemaStatus.valid ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                          schemaStatus.type === 'empty' ? 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400' :
                          'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                        }`}>
                        {schemaStatus.type === 'invalid' ? 'Syntax Error' : schemaStatus.type}
                      </span>
                    </div>
                    <textarea
                      id="schema"
                      ref={textareaRef}
                      value={local.schema}
                      onChange={(e) => updateLocal({ schema: e.target.value })}
                      placeholder="Paste your full Swagger JSON/YAML, or a specific endpoint's requestBody schema snippet here..."
                      className={`w-full h-56 bg-[#F1F1F0] dark:bg-[#1c1c1c] border ${schemaStatus.type === 'invalid' ? 'border-red-400 focus:ring-red-500' : 'border-[#D1D1CF] dark:border-[#333] focus:ring-[#141414] dark:focus:ring-[#666]'} rounded p-3 font-mono text-xs text-[#141414] dark:text-[#f0f0f0] focus:outline-none focus:ring-1 focus:bg-white dark:focus:bg-[#111] transition-colors selection:bg-[#E4E4E2] dark:selection:bg-[#444] selection:text-black dark:selection:text-white`}
                    />
                    {schemaStatus.type === 'invalid' && (
                      <p className="text-[11px] text-red-600 dark:text-red-400 mt-1 font-mono">{schemaStatus.message}</p>
                    )}
                  </div>
                ) : (
                  <div>
                    <div className="flex justify-between items-end mb-2">
                      <label className="block text-xs font-bold text-[#888] uppercase tracking-wider">
                        Schema Hierarchy & Data Mapper
                      </label>
                    </div>
                    {/* Render visual inspector */}
                    <SchemaInspector 
                      parsedSchema={schemaStatus.parsed} 
                      mappings={local.fieldMappings} 
                      onMapChange={handleMapChange} 
                    />
                  </div>
                )}
                
                <div>
                  <label htmlFor="endpoint" className="block text-xs font-bold text-[#888] uppercase tracking-wider mb-2">
                    Target Endpoint (Optional)
                  </label>
                  {availableEndpoints.length > 0 ? (
                    <select
                      id="endpoint"
                      value={local.endpoint}
                      onChange={(e) => updateLocal({ endpoint: e.target.value })}
                      className="w-full bg-[#F1F1F0] dark:bg-[#1c1c1c] border border-[#D1D1CF] dark:border-[#333] rounded p-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#141414] dark:focus:ring-[#666] focus:bg-white dark:focus:bg-[#111] transition-colors dark:text-[#f0f0f0]"
                    >
                      <option value="">-- Let AI Decide --</option>
                      {availableEndpoints.map(ep => (
                        <option key={ep} value={ep}>{ep}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      id="endpoint"
                      value={local.endpoint}
                      onChange={(e) => updateLocal({ endpoint: e.target.value })}
                      placeholder="e.g. POST /api/v1/users"
                      className="w-full bg-[#F1F1F0] dark:bg-[#1c1c1c] border border-[#D1D1CF] dark:border-[#333] rounded p-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#141414] dark:focus:ring-[#666] focus:bg-white dark:focus:bg-[#111] transition-colors dark:text-[#f0f0f0] dark:placeholder-[#666]"
                    />
                  )}
                  <p className="text-[10px] text-[#888] mt-1 font-medium">If pasting a full Swagger file{availableEndpoints.length > 0 ? ", we detected multiple targets above" : ""}, specify which endpoint to generate data for.</p>
                </div>
              </div>
            </div>

            {/* Input Section 2: Generation Settings */}
            <div className="bg-white dark:bg-[#141414] border-b border-[#D1D1CF] dark:border-[#333] transition-colors">
              <div className="p-4 border-b border-[#D1D1CF] dark:border-[#333] bg-[#F8F8F7] dark:bg-[#1c1c1c] flex justify-between items-center transition-colors">
                <h2 className="text-[11px] font-bold text-[#888] dark:text-[#a0a0a0] uppercase tracking-widest flex items-center gap-2">
                  <Settings2 className="w-4 h-4" />
                  Configuration Panel
                </h2>
              </div>
              <div className="p-5 space-y-4">
                
                <div className="mb-4">
                  <label htmlFor="rootCount" className="block text-xs font-bold text-[#888] uppercase tracking-wider mb-2">
                    Root Array Size (Batch Generation)
                  </label>
                  <input
                    type="number"
                    id="rootCount"
                    min="1"
                    max="100"
                    value={local.rootCount}
                    onChange={(e) => updateLocal({ rootCount: parseInt(e.target.value) || 1 })}
                    className="w-full bg-[#F1F1F0] dark:bg-[#1c1c1c] border border-[#D1D1CF] dark:border-[#333] rounded p-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#141414] dark:focus:ring-[#666] dark:text-[#f0f0f0] transition-colors"
                  />
                </div>

                <div className="bg-[#F8F8F7] dark:bg-[#141414] p-3 rounded border border-[#E4E4E2] dark:border-[#333] transition-colors">
                  <div className="flex gap-4">
                    <div className="flex-1 relative group">
                      <label htmlFor="arrayMin" className="block text-xs font-bold text-[#888] uppercase tracking-wider mb-2 cursor-help border-b border-dashed border-[#888] inline-block pb-0.5">
                        Array Bounds: Min
                      </label>
                      <input
                        type="number"
                        id="arrayMin"
                        min="0"
                        max="50"
                        value={local.arrayMin}
                        onChange={(e) => updateLocal({ arrayMin: parseInt(e.target.value) || 0 })}
                        className="w-full bg-white dark:bg-[#1c1c1c] border border-[#D1D1CF] dark:border-[#333] rounded p-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#141414] dark:focus:ring-[#666] dark:text-[#f0f0f0] transition-colors"
                      />
                      <div className="absolute top-[-42px] left-0 opacity-0 group-hover:opacity-100 transition-opacity bg-white dark:bg-[#2a2a2a] px-2 py-1.5 rounded shadow border border-[#E4E4E2] dark:border-[#444] text-[10px] text-[#555] dark:text-[#ccc] pointer-events-none z-10 w-48 font-medium">
                         Min length limit for any nested arrays discovered inside the schema body.
                      </div>
                    </div>
                    <div className="flex-1 relative group">
                      <label htmlFor="arrayMax" className="block text-xs font-bold text-[#888] uppercase tracking-wider mb-2 cursor-help border-b border-dashed border-[#888] inline-block pb-0.5">
                        Array Bounds: Max
                      </label>
                      <input
                        type="number"
                        id="arrayMax"
                        min="0"
                        max="100"
                        value={local.arrayMax}
                        onChange={(e) => updateLocal({ arrayMax: parseInt(e.target.value) || 0 })}
                        className="w-full bg-white dark:bg-[#1c1c1c] border border-[#D1D1CF] dark:border-[#333] rounded p-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#141414] dark:focus:ring-[#666] dark:text-[#f0f0f0] transition-colors"
                      />
                      <div className="absolute top-[-42px] right-0 opacity-0 group-hover:opacity-100 transition-opacity bg-white dark:bg-[#2a2a2a] px-2 py-1.5 rounded shadow border border-[#E4E4E2] dark:border-[#444] text-[10px] text-[#555] dark:text-[#ccc] pointer-events-none z-10 w-48 font-medium">
                         Max length limit for any nested arrays discovered inside the schema body.
                      </div>
                    </div>
                  </div>
                  
                  <div className="mt-3 flex items-center gap-2">
                    <input 
                      type="checkbox" 
                      id="uniqueArrays" 
                      checked={local.uniqueArrays} 
                      onChange={e => updateLocal({ uniqueArrays: e.target.checked })}
                      className="w-4 h-4 rounded border-[#D1D1CF] dark:border-[#333] text-[#141414] dark:text-[#f0f0f0] focus:ring-[#141414] dark:focus:ring-[#888] dark:bg-[#1c1c1c] transition-colors"
                    />
                    <label htmlFor="uniqueArrays" className="text-[11px] font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider cursor-pointer">
                      Ensure elements inside nested arrays are UNIQUE
                    </label>
                  </div>
                </div>

                <div>
                  <label htmlFor="customRules" className="block text-xs font-bold text-[#888] uppercase tracking-wider mb-2">
                    Custom Values & Constraints
                  </label>
                  <textarea
                    id="customRules"
                    value={local.customRules}
                    onChange={(e) => updateLocal({ customRules: e.target.value })}
                    placeholder="e.g. 'id' must be a UUID v4. 'price' is a float with 2 decimals. 'status' is always 'ACTIVE'."
                    className="w-full h-24 bg-[#F1F1F0] dark:bg-[#1c1c1c] border border-[#D1D1CF] dark:border-[#333] rounded p-3 text-sm focus:outline-none focus:ring-1 focus:ring-[#141414] dark:focus:ring-[#666] focus:bg-white dark:focus:bg-[#111] dark:text-[#f0f0f0] dark:placeholder-[#666] transition-colors"
                  />
                  <p className="text-[10px] text-[#888] mt-1 font-medium">Define custom data types, formats, or exact values to override the schema definition.</p>
                </div>
              </div>
            </div>
            
          </div>
        </section>

        {/* Right Sidebar: Output */}
        <section className="w-1/2 flex flex-col bg-[#1E1E1E] min-w-0">
          <div className="p-4 border-b border-white/10 flex justify-between items-center shrink-0">
            <p className="text-[11px] font-bold text-white/40 uppercase tracking-widest flex items-center gap-2">
              <FileJson className="w-4 h-4" />
              JSON Output
            </p>
            <div className="flex items-center gap-3">
              {validationErrors && validationErrors.length > 0 && !isValidating && (
                 <span className="text-[10px] font-bold text-red-400 bg-red-400/10 px-2 py-0.5 rounded border border-red-400/20">
                    {validationErrors.length} ISSUES DETECTED
                 </span>
              )}
              {validationErrors && validationErrors.length === 0 && !isValidating && (
                 <span className="text-[10px] font-bold text-green-400 bg-green-400/10 px-2 py-0.5 rounded border border-green-400/20">
                    SCHEMA VALIDATED
                 </span>
              )}

              {isGenerating ? (
                <span className="text-[10px] text-yellow-400 font-mono animate-pulse">GENERATING...</span>
              ) : isFixing ? (
                <span className="text-[10px] text-orange-400 font-mono animate-pulse uppercase">AUTO-FIXING...</span>
              ) : isValidating ? (
                <span className="text-[10px] text-[#9CDCFE] font-mono animate-pulse uppercase">VALIDATING SCHEMA...</span>
              ) : output ? (
                <span className="text-[10px] text-green-400 font-mono">LIVE UPDATING</span>
              ) : null}
            </div>
          </div>
          
          <div className="flex-1 overflow-auto relative p-4 flex flex-col">
            {output ? (
              <>
                <pre className="font-mono text-[13px] text-[#D4D4D4] leading-relaxed flex-1">
                  {output}
                </pre>
                
                {/* Validation Overlay Box */}
                {validationErrors && validationErrors.length > 0 && (
                  <div className="mt-4 bg-[#2D1B1B] border border-red-900/50 rounded p-4 shrink-0 shadow-lg">
                    <div className="flex items-center justify-between mb-3 border-b border-red-900/40 pb-2">
                      <div className="flex items-center gap-2 text-red-400">
                        <AlertTriangle className="w-4 h-4" />
                        <h3 className="text-xs font-bold uppercase tracking-widest">Validation Discrepancies</h3>
                      </div>
                      <button
                        onClick={handleAutoFix}
                        disabled={isFixing || isValidating}
                        className="px-3 py-1 bg-red-900/50 hover:bg-red-800/80 text-white text-[10px] font-bold uppercase tracking-wider rounded border border-red-800 transition-colors flex items-center gap-1.5 disabled:opacity-50"
                      >
                        {isFixing ? (
                           <svg className="animate-spin h-3 w-3 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                        ) : (
                           <Wrench className="w-3 h-3" />
                        )}
                        Auto-Fix with AI
                      </button>
                    </div>
                    <ul className="space-y-2">
                      {validationErrors.map((errText, idx) => (
                        <li key={idx} className="flex gap-2 text-xs font-mono text-[#D4D4D4]">
                           <span className="text-red-500 font-bold shrink-0">[{idx + 1}]</span>
                           <span className="break-words opacity-90">{errText}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-white/20">
                <FileJson className="w-12 h-12 mb-4 opacity-30" />
                <p className="font-medium text-sm">Ready to generate data</p>
                <p className="text-xs mt-1 opacity-50 px-8 text-center flex flex-col gap-1">
                  <span>Provide your valid JSON/YAML schema on the left.</span>
                  <span>Set your configuration rules.</span>
                  <span>Hit "Generate" to see realistic mock JSON.</span>
                </p>
              </div>
            )}
          </div>

          <div className="p-4 border-t border-white/10 flex gap-3 bg-[#252526] shrink-0">
             <button
                onClick={handleExport}
                disabled={!output}
                className="flex-1 py-2 bg-blue-600 text-white rounded font-semibold text-sm hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center transition-colors"
              >
                Download JSON File
              </button>
              <button
                onClick={handleCopy}
                disabled={!output}
                className="flex-1 py-2 bg-white/5 text-white/80 rounded font-medium text-sm hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center transition-colors border border-white/5"
              >
                {copied ? 'Copied!' : 'Copy to Clipboard'}
              </button>
          </div>
        </section>

      </main>

      {/* Bottom Status Bar */}
      <footer className="h-8 border-t border-[#D1D1CF] dark:border-[#333] bg-[#F8F8F7] dark:bg-[#1c1c1c] px-4 flex items-center justify-between shrink-0 transition-colors">
        <div className="flex items-center gap-4 text-[10px] font-medium uppercase text-[#888] dark:text-[#a0a0a0]">
          <span className={`flex items-center gap-1 ${output ? 'text-green-600 dark:text-green-400' : 'text-[#888] dark:text-[#a0a0a0]'}`}>
            <span className={`w-2 h-2 rounded-full ${isGenerating ? 'bg-yellow-500 animate-pulse' : isValidating || isFixing ? 'bg-[#9CDCFE] animate-pulse' : output ? 'bg-green-500' : 'bg-[#D1D1CF] dark:bg-[#444]'}`}></span> 
            {isGenerating ? 'Generating' : isFixing ? 'Auto-Fixing' : isValidating ? 'Validating' : output ? 'Ready' : 'Idle'}
          </span>
          <span className={schemaStatus.type === 'invalid' ? 'text-red-500 dark:text-red-400' : ''}>
            Format: {schemaStatus.type.toUpperCase() || 'UNKNOWN'}
          </span>
          {output && <span>Length: {output.length} characters</span>}
        </div>
        <div className="text-[10px] text-[#888] dark:text-[#a0a0a0] font-mono">
          Model: gemini-2.5-flash | Configs Saved: {savedConfigs.length}
        </div>
      </footer>

    </div>
  );
}
