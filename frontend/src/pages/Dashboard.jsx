import { useState, useCallback, useRef, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApp }          from '../context/AppContext';
import { useStreamFetch }  from '../hooks/useStreamFetch';
import AuthGate      from '../components/AuthGate';
import Header        from '../components/Header';
import StreamOutput  from '../components/StreamOutput';
import Spinner       from '../components/Spinner';

// ── Voice input hook (Web Speech API) ────────────────────────────────────────
function useVoice(onTranscript) {
  const [listening, setListening]     = useState(false);
  const [supported, setSupported]     = useState(false);
  const [elapsed, setElapsed]         = useState(0);       // seconds
  const [liveText, setLiveText]       = useState('');      // interim preview
  const recognitionRef                = useRef(null);
  const finalTextRef                  = useRef('');        // accumulated finals
  const timerRef                      = useRef(null);

  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    setSupported(true);
    const r = new SR();
    r.continuous     = true;   // keep recording until user stops
    r.interimResults = true;
    r.lang           = 'en-US';

    r.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalTextRef.current += t + ' ';
        else interim += t;
      }
      setLiveText(interim);
    };

    r.onerror = () => stopRecording(r);
    r.onend   = () => {
      // auto-restart if still listening (browser cuts off after ~60s silence)
      if (recognitionRef.current?._keepGoing) {
        try { r.start(); } catch (_) { stopRecording(r); }
      }
    };

    recognitionRef.current = r;
    return () => { r._keepGoing = false; r.abort(); clearInterval(timerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function stopRecording(r) {
    if (!r) return;
    r._keepGoing = false;
    r.stop();
    clearInterval(timerRef.current);
    setListening(false);
    setElapsed(0);
    setLiveText('');
    const text = finalTextRef.current.trim();
    finalTextRef.current = '';
    if (text) onTranscript(text);
  }

  const toggle = useCallback(() => {
    const r = recognitionRef.current;
    if (!r) return;
    if (listening) {
      stopRecording(r);
    } else {
      finalTextRef.current = '';
      setElapsed(0);
      setLiveText('');
      r._keepGoing = true;
      r.start();
      setListening(true);
      timerRef.current = setInterval(() => setElapsed(s => s + 1), 1000);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listening]);

  return { listening, supported, toggle, elapsed, liveText };
}

const QUICK_ACTIONS = [
  { label: 'Search contacts',       prompt: 'List the 10 most recently added contacts in GHL.' },
  { label: 'Active opportunities',  prompt: 'Show all open opportunities and their pipeline stages.' },
  { label: 'Pending appointments',  prompt: 'List all upcoming appointments for the next 7 days.' },
  { label: 'List workflows',        prompt: 'List all available GHL workflows and their status.' },
  { label: 'Bulk SMS draft',        prompt: 'Draft an SMS to all contacts tagged "lead". Show me the message before sending.' },
  { label: 'Research competitor',   prompt: 'Research our top 3 competitors using Perplexity and summarize their positioning.' },
  { label: 'Write blog post',       prompt: 'Write a 600-word SEO blog post about [topic]. Format it for GHL blog.' },
  { label: 'Create invoice',        prompt: 'List all GHL products and show me the steps to create a new invoice.' },
  { label: 'Apollo prospecting',    prompt: 'Find 10 marketing directors at SaaS companies using Apollo and add them as GHL contacts tagged "apollo-lead".' },
  { label: 'Email campaign',        prompt: 'Draft a promotional email campaign and send via SendGrid to all contacts tagged "subscribed".' },
  { label: 'Social post drafts',    prompt: 'List my connected social accounts, then create 3 engaging social media post drafts (status: DRAFT) for me to review in the Social Planner. Ask me for the topic or promotion first.' },
  { label: 'Week of social content',prompt: 'List my connected social accounts, then generate a full week of social media content (7 posts, one per day) and save each as DRAFT in the Social Planner. Ask me for the brand/topic first.' },
];

// ── Slash commands ────────────────────────────────────────────────────────────
const SLASH_COMMANDS = [
  { cmd: '/search_contacts',    label: 'Search Contacts',       placeholder: '/search_contacts John Smith',          task: q => `Search contacts with query: ${q}` },
  { cmd: '/get_contact',        label: 'Get Contact',           placeholder: '/get_contact jane@email.com',          task: q => `Get full details for contact: ${q}` },
  { cmd: '/create_contact',     label: 'Create Contact',        placeholder: '/create_contact Jane Doe jane@email.com', task: q => `Create a new contact: ${q}` },
  { cmd: '/update_contact',     label: 'Update Contact',        placeholder: '/update_contact John Smith email newjohn@email.com phone +1234567890', task: q => `Find and update contact — ${q}. Search for the contact first to get their ID, then update the specified fields.` },
  { cmd: '/send_sms',           label: 'Send SMS',              placeholder: '/send_sms +1234567890 Hello!',         task: q => `Send SMS: ${q}` },
  { cmd: '/send_email',         label: 'Send Email',            placeholder: '/send_email to@email.com Subject Body', task: q => `Send email: ${q}` },
  { cmd: '/list_opportunities', label: 'List Opportunities',    placeholder: '/list_opportunities',                  task: () => 'List all opportunities in the pipeline' },
  { cmd: '/create_opportunity', label: 'Create Opportunity',    placeholder: '/create_opportunity Deal Name $5000',  task: q => `Create a new opportunity: ${q}` },
  { cmd: '/list_workflows',     label: 'List Workflows',        placeholder: '/list_workflows',                      task: () => 'List all automation workflows' },
  { cmd: '/list_appointments',  label: 'List Appointments',     placeholder: '/list_appointments',                   task: () => 'List upcoming appointments' },
  { cmd: '/list_calendars',     label: 'List Calendars',        placeholder: '/list_calendars',                      task: () => 'List all calendars' },
  { cmd: '/add_tag',            label: 'Add Tag to Contact',    placeholder: '/add_tag contactId TagName',           task: q => `Add tag to contact: ${q}` },
  { cmd: '/remove_tag',         label: 'Remove Tag',            placeholder: '/remove_tag contactId TagName',        task: q => `Remove tag from contact: ${q}` },
  { cmd: '/list_conversations', label: 'List Conversations',    placeholder: '/list_conversations',                  task: () => 'List recent conversations' },
  { cmd: '/list_invoices',      label: 'List Invoices',         placeholder: '/list_invoices',                       task: () => 'List all invoices' },
  { cmd: '/list_forms',         label: 'List Forms',            placeholder: '/list_forms',                          task: () => 'List all forms' },
  { cmd: '/create_blog_post',   label: 'Create Blog Post',      placeholder: '/create_blog_post Title about Topic',  task: q => `Create a blog post: ${q}` },
  { cmd: '/create_social_post', label: 'Create Social Post',    placeholder: '/create_social_post My message here',  task: q => `Create a social media post: ${q}` },
];

// Accumulate streamed text into messages array
function applyEvent(prev, evtType, data) {
  if (evtType === 'text') {
    const last = prev[prev.length - 1];
    if (last?.type === 'text') {
      return [...prev.slice(0, -1), { ...last, text: last.text + data.text }];
    }
    return [...prev, { type: 'text', text: data.text }];
  }
  if (evtType === 'tool_call')   return [...prev, { type: 'tool_call',   name: data.name,   input:  data.input }];
  if (evtType === 'tool_result') return [...prev, { type: 'tool_result', name: data.name,   result: data.result }];
  if (evtType === 'done')        return [...prev, { type: 'done',  turns: data.turns, toolCallCount: data.toolCallCount }];
  if (evtType === 'error')       return [...prev, { type: 'error', error: data.error }];
  return prev;
}

export default function Dashboard() {
  const { isAuthenticated, isAuthLoading, apiKey, claudeReady, enabledTools, integrations, integrationsLoaded, canAccess, userRole } = useApp();
  const [task, setTask]         = useState('');
  const [messages, setMessages] = useState([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showLibrary,   setShowLibrary]   = useState(false);
  const [library,       setLibrary]       = useState([]);    // folders[]
  const [activeFolder,  setActiveFolder]  = useState(null);  // folder id
  const [activePersona, setActivePersona] = useState(null);  // { title, content } — prepended to every run
  const [libLoading,    setLibLoading]    = useState(false);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [newFolderIcon, setNewFolderIcon] = useState('📁');
  const [showNewPrompt, setShowNewPrompt] = useState(false);
  const [newPromptTitle,setNewPromptTitle]= useState('');
  const [newPromptBody, setNewPromptBody] = useState('');
  // ── Persona training ───────────────────────────────────────────────────────
  const [trainFolder,   setTrainFolder]   = useState(null);   // folder id being trained
  const [trainPromptId, setTrainPromptId] = useState(null);   // null=new, pid=updating existing
  const [trainMsgs,     setTrainMsgs]     = useState([]);     // [{role,content}]
  const [trainInput,    setTrainInput]    = useState('');
  const [trainLoading,  setTrainLoading]  = useState(false);
  const [trainGenerated,setTrainGenerated]= useState('');     // finalized persona text
  const [trainSaveTitle,setTrainSaveTitle]= useState('');
  const { isRunning, stream, stop } = useStreamFetch();
  const [slashOpen,   setSlashOpen]   = useState(false);
  const [slashFilter, setSlashFilter] = useState('');
  const textareaRef = useRef(null);

  const { listening, supported: voiceSupported, toggle: toggleVoice, elapsed, liveText } = useVoice(
    (transcript) => setTask(prev => (prev ? prev + ' ' + transcript : transcript))
  );

  const navigate = useNavigate();

  // localStorage key scoped per location so different accounts don't share state
  const trainSessionKey = apiKey ? `train_session_${apiKey}` : null;

  const saveTrainSession  = (folderId, promptId) => {
    if (!trainSessionKey) return;
    localStorage.setItem(trainSessionKey, JSON.stringify({ folderId, promptId }));
  };
  const clearTrainSession = () => {
    if (trainSessionKey) localStorage.removeItem(trainSessionKey);
  };

  const loadLibrary = useCallback(async () => {
    if (!apiKey) return;
    setLibLoading(true);
    try {
      const res  = await fetch('/prompts', { headers: { 'x-location-id': apiKey } });
      const data = await res.json();
      if (data.success) {
        const folders = data.data || [];
        setLibrary(folders);

        // ── Restore training session after page reload ────────────────────────
        // Skip restore if training is already active (e.g. deferred loadLibrary from autoSave)
        if (!trainFolderRef.current) {
          const key = `train_session_${apiKey}`;
          const saved = localStorage.getItem(key);
          if (saved) {
            try {
              const { folderId, promptId } = JSON.parse(saved);
              const folder = folders.find(f => f.id === folderId);
              if (folder) {
                const prompt = promptId ? folder.prompts?.find(p => p.id === promptId) : null;
                // Restore: open library panel, select folder, resume training
                setShowLibrary(true);
                setActiveFolder(folderId);
                const pid = prompt?.id || null;
                autoSaveTrainingRef.current = pid;
                trainFolderRef.current      = folderId;
                const history = prompt?.trainHistory || [];
                trainMsgsRef.current = history;
                setTrainFolder(folderId);
                setTrainPromptId(pid);
                setTrainMsgs(history);
                setTrainSaveTitle(prompt?.isDraft ? '' : (prompt?.title || ''));
              } else {
                localStorage.removeItem(key);
              }
            } catch { localStorage.removeItem(key); }
          }
        }
      }
    } catch { /* non-fatal */ }
    finally { setLibLoading(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey]);

  // Load library on mount (to restore session) and whenever panel opens
  useEffect(() => { if (apiKey) loadLibrary(); }, [apiKey, loadLibrary]);
  useEffect(() => { if (showLibrary) loadLibrary(); }, [showLibrary, loadLibrary]);

  const run = useCallback(async (taskText) => {
    if (!taskText.trim() || isRunning) return;
    setMessages([]);
    const fullTask = activePersona
      ? `[System Context — ${activePersona.title}]:\n${activePersona.content}\n\n---\n\n${taskText.trim()}`
      : taskText.trim();
    await stream('/claude/task', { task: fullTask }, (evtType, data) => {
      setMessages(prev => applyEvent(prev, evtType, data));
    }, apiKey);
  }, [isRunning, stream, apiKey, activePersona]);

  const apiHeaders = { 'Content-Type': 'application/json', 'x-location-id': apiKey };

  const createFolder = async () => {
    if (!newFolderName.trim()) return;
    await fetch('/prompts/folders', { method: 'POST', headers: apiHeaders,
      body: JSON.stringify({ name: newFolderName.trim(), icon: newFolderIcon }) });
    setNewFolderName(''); setNewFolderIcon('📁'); setShowNewFolder(false);
    loadLibrary();
  };

  const deleteFolder = async (fid) => {
    await fetch(`/prompts/folders/${fid}`, { method: 'DELETE', headers: apiHeaders });
    if (activeFolder === fid) setActiveFolder(null);
    loadLibrary();
  };

  const createPrompt = async () => {
    if (!newPromptTitle.trim() || !newPromptBody.trim() || !activeFolder) return;
    await fetch(`/prompts/folders/${activeFolder}/prompts`, { method: 'POST', headers: apiHeaders,
      body: JSON.stringify({ title: newPromptTitle.trim(), content: newPromptBody.trim() }) });
    setNewPromptTitle(''); setNewPromptBody(''); setShowNewPrompt(false);
    loadLibrary();
  };

  const deletePrompt = async (fid, pid) => {
    await fetch(`/prompts/folders/${fid}/prompts/${pid}`, { method: 'DELETE', headers: apiHeaders });
    loadLibrary();
  };

  const usePrompt = (p) => {
    setTask(p.content);
    setShowLibrary(false);
  };

  const setPersona = (p) => {
    setActivePersona(prev => prev?.id === p.id ? null : { id: p.id, title: p.title, content: p.content });
  };

  const saveCurrentAsPrompt = async () => {
    if (!task.trim() || !activeFolder) return;
    const title = window.prompt('Prompt title?');
    if (!title) return;
    await fetch(`/prompts/folders/${activeFolder}/prompts`, { method: 'POST', headers: apiHeaders,
      body: JSON.stringify({ title: title.trim(), content: task.trim() }) });
    loadLibrary();
  };

  // ── Persona training refs (stable across re-renders, safe in async callbacks) ──
  const autoSaveTrainingRef = useRef(null); // current draft prompt id
  const trainMsgsRef        = useRef([]);   // mirror of trainMsgs for async closures
  const trainFolderRef      = useRef(null); // mirror of trainFolder for async closures
  const trainChatEndRef     = useRef(null); // scroll-to-bottom anchor
  const pendingSaveRef      = useRef(null); // tracks in-flight autoSave promise

  // Keep refs in sync with state
  useEffect(() => { trainMsgsRef.current  = trainMsgs;  }, [trainMsgs]);
  useEffect(() => { trainFolderRef.current = trainFolder; }, [trainFolder]);

  // Scroll to bottom whenever messages change
  useEffect(() => {
    trainChatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [trainMsgs, trainLoading]);

  const startTraining = async (folderId, existingPrompt = null) => {
    const pid = existingPrompt?.id || null;
    autoSaveTrainingRef.current = pid;
    trainFolderRef.current      = folderId;
    setTrainFolder(folderId);
    setTrainPromptId(pid);
    setActiveFolder(folderId);
    setTrainInput('');
    setTrainGenerated('');
    setTrainSaveTitle(existingPrompt?.isDraft ? '' : (existingPrompt?.title || ''));
    saveTrainSession(folderId, pid);

    // Fetch fresh training history directly from backend to avoid stale library state
    if (pid) {
      try {
        const res = await fetch(`/prompts/folders/${folderId}/prompts/${pid}`, {
          headers: { 'x-location-id': apiKey },
        });
        const data = await res.json();
        if (data.success) {
          const history = data.data.trainHistory || [];
          trainMsgsRef.current = history;
          setTrainMsgs(history);
          return;
        }
      } catch { /* fall through to use library data */ }
    }
    // Fallback: use what's already in the library state
    const history = existingPrompt?.trainHistory || [];
    trainMsgsRef.current = history;
    setTrainMsgs(history);
  };

  // Auto-save to Firebase after every exchange — fire-and-forget, never blocks UI
  const autoSaveTraining = useCallback((currentMsgs, currentDraftId, folderId) => {
    if (!folderId) return; // training was exited before save
    const savePromise = (async () => { try {
      const headers = { 'Content-Type': 'application/json', 'x-location-id': apiKey };
      if (currentDraftId) {
        const r = await fetch(`/prompts/folders/${folderId}/prompts/${currentDraftId}`, {
          method: 'PUT', headers,
          body: JSON.stringify({ trainHistory: currentMsgs }),
        });
        const rj = await r.json();
        if (!rj.success) console.error('[Training] PUT failed:', rj.error);
        else console.log('[Training] Saved', currentMsgs.length, 'messages to Firebase');
      } else {
        // First exchange — create a draft to anchor this session
        const res  = await fetch(`/prompts/folders/${folderId}/prompts`, {
          method: 'POST', headers,
          body: JSON.stringify({
            title:        'Training in Progress…',
            content:      '(Persona not yet finalized — continue training to generate)',
            isDraft:      true,
            trainHistory: currentMsgs,
          }),
        });
        const data = await res.json();
        if (!data.success) { console.error('[Training] POST draft failed:', data.error); return; }
        if (data.success) {
          console.log('[Training] Draft created in Firebase, pid:', data.data.id);
          const newPid = data.data.id;
          autoSaveTrainingRef.current = newPid;
          setTrainPromptId(newPid);
          // Persist updated promptId so reload restores to exact draft
          if (trainSessionKey) {
            const cur = localStorage.getItem(trainSessionKey);
            if (cur) {
              try {
                const s = JSON.parse(cur);
                localStorage.setItem(trainSessionKey, JSON.stringify({ ...s, promptId: newPid }));
              } catch { /* ignore */ }
            }
          }
          // Refresh library in background so draft appears — deferred to avoid disrupting chat state
          setTimeout(loadLibrary, 500);
        }
      }
    } catch { /* non-fatal — training continues even if save fails */ }
    })();
    pendingSaveRef.current = savePromise;
    return savePromise;
  }, [apiKey, loadLibrary]);

  const exitTraining = useCallback(async () => {
    // Wait for any in-flight save to complete before refreshing library
    if (pendingSaveRef.current) {
      try { await pendingSaveRef.current; } catch { /* ignore */ }
      pendingSaveRef.current = null;
    }
    if (trainSessionKey) localStorage.removeItem(trainSessionKey);
    autoSaveTrainingRef.current = null;
    trainMsgsRef.current        = [];
    trainFolderRef.current      = null;
    setTrainFolder(null);
    setTrainPromptId(null);
    setTrainMsgs([]);
    setTrainGenerated('');
    setTrainInput('');
    setTrainLoading(false);
    setTrainSaveTitle('');
    await loadLibrary(); // direct await — no race condition
  }, [trainSessionKey, loadLibrary]);

  const sendTrainMsg = useCallback(async (overrideAction) => {
    const content = trainInput.trim();
    if (!content && !overrideAction) return;

    // Build message list using ref (stable, not stale)
    const userMsg   = content ? { role: 'user', content } : null;
    const msgsToSend = userMsg ? [...trainMsgsRef.current, userMsg] : trainMsgsRef.current;

    if (userMsg) {
      trainMsgsRef.current = msgsToSend;
      setTrainMsgs(msgsToSend);
    }
    setTrainInput('');
    setTrainLoading(true);

    try {
      const res  = await fetch('/prompts/train', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'x-location-id': apiKey },
        body:    JSON.stringify({ messages: msgsToSend, action: overrideAction || 'chat' }),
      });
      const data = await res.json();
      // Guard: user may have exited training while request was in-flight
      if (!trainFolderRef.current) return;
      if (data.success) {
        if (overrideAction === 'finalize') {
          setTrainGenerated(data.reply);
          setTrainSaveTitle(prev => prev || 'My Custom Persona');
        } else {
          const updatedMsgs = [...msgsToSend, { role: 'assistant', content: data.reply }];
          trainMsgsRef.current = updatedMsgs;
          setTrainMsgs(updatedMsgs);
          // Auto-save using refs so we never read stale state
          autoSaveTraining(updatedMsgs, autoSaveTrainingRef.current, trainFolderRef.current);
        }
      }
    } catch { /* non-fatal */ }
    finally { setTrainLoading(false); }
  }, [apiKey, trainInput, autoSaveTraining]);

  const saveTrainedPersona = async () => {
    if (!trainGenerated.trim() || !trainSaveTitle.trim() || !trainFolderRef.current) return;
    const currentId = autoSaveTrainingRef.current;
    const headers   = { 'Content-Type': 'application/json', 'x-location-id': apiKey };
    const payload   = { title: trainSaveTitle.trim(), content: trainGenerated.trim(), trainHistory: trainMsgsRef.current, isDraft: false };
    if (currentId) {
      await fetch(`/prompts/folders/${trainFolderRef.current}/prompts/${currentId}`, {
        method: 'PUT', headers, body: JSON.stringify(payload),
      });
    } else {
      await fetch(`/prompts/folders/${trainFolderRef.current}/prompts`, {
        method: 'POST', headers, body: JSON.stringify(payload),
      });
    }
    clearTrainSession();
    autoSaveTrainingRef.current = null;
    trainMsgsRef.current        = [];
    trainFolderRef.current      = null;
    setTrainFolder(null); setTrainPromptId(null); setTrainMsgs([]); setTrainGenerated(''); setTrainSaveTitle('');
    loadLibrary();
  };

  function resolveSlashTask(input) {
    const trimmed = input.trim();
    if (!trimmed.startsWith('/')) return trimmed;
    const spaceIdx = trimmed.indexOf(' ');
    const cmd  = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
    const args = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1).trim();
    const found = SLASH_COMMANDS.find(c => c.cmd === cmd);
    return found ? found.task(args) : trimmed;
  }

  const handleSubmit = () => { run(resolveSlashTask(task)); };

  function handleTaskChange(e) {
    const val = e.target.value;
    setTask(val);
    if (val.startsWith('/') && !val.includes('\n')) {
      const spaceIdx = val.indexOf(' ');
      const typing = spaceIdx === -1 ? val.slice(1) : val.slice(1, spaceIdx);
      setSlashFilter(typing.toLowerCase());
      setSlashOpen(spaceIdx === -1); // close dropdown once user starts typing args
    } else {
      setSlashOpen(false);
    }
  }

  function selectSlashCommand(cmd) {
    setTask(cmd.placeholder);
    setSlashOpen(false);
    setTimeout(() => textareaRef.current?.focus(), 0);
  }
  const handleChip   = (p) => { setTask(p); run(p); setSidebarOpen(false); };

  if (isAuthLoading)    return <Spinner />;
  if (!isAuthenticated) return (
    <AuthGate icon="🤖" title="GTM AI Command Center" subtitle="Enter your location API key to continue">
      <p className="text-center text-xs text-gray-600 mt-4">
        Get your key from GHL → Settings → API Keys
      </p>
    </AuthGate>
  );

  const connected = (integrations || []).filter(i => i.enabled);

  // Group social and payment tools into summary entries
  // ghl_social_planner = GHL-connected accounts; social_* = direct OAuth connections
  const SOCIAL_KEYS  = ['ghl_social_planner','social_facebook','social_instagram','social_tiktok_organic','social_youtube','social_linkedin_organic','social_pinterest','social_twitter','social_gmb'];
  const PAYMENT_KEYS = ['stripe','paypal','square','authorizenet'];

  const socialConnected  = connected.filter(i => SOCIAL_KEYS.includes(i.key));
  const paymentConnected = connected.filter(i => PAYMENT_KEYS.includes(i.key));
  // Exclude zero-toolCount items (e.g. ghl_social_planner) from individual display — they belong in groups only
  const otherConnected   = connected.filter(i => !SOCIAL_KEYS.includes(i.key) && !PAYMENT_KEYS.includes(i.key) && (i.toolCount || 0) > 0);

  // Count unique connected social platforms:
  // ghl_social_planner stores a platforms[] array; individual social_* keys each = 1 platform
  const socialPlatforms = new Set();
  socialConnected.forEach(i => {
    if (i.key === 'ghl_social_planner') {
      (i.configPreview?.platforms || []).forEach(p => socialPlatforms.add(p));
    } else {
      socialPlatforms.add(i.key.replace('social_', '').replace('_organic', ''));
    }
  });
  const socialCount = socialPlatforms.size || socialConnected.length;

  const sidebarItems = [
    ...otherConnected,
    ...(socialConnected.length  > 0 ? [{ key: '__social_hub', label: 'Social Hub',      icon: '📱', count: socialCount            }] : []),
    ...(paymentConnected.length > 0 ? [{ key: '__payment_gw', label: 'Payment Gateway', icon: '💳', count: paymentConnected.length }] : []),
  ];

  return (
    <div className="flex flex-col" style={{ height: '100%', background: '#0f0f13' }}>
      <Header
        icon="🤖"
        title="GTM AI Command Center"
        subtitle={`Claude Opus 4.6 · ${enabledTools.length} active tools · ${connected.length} connected`}
        onMenuClick={() => setSidebarOpen(v => !v)}
      />

      <div className="flex flex-1 overflow-hidden" style={{ position: 'relative' }}>

        {/* ── Backdrop overlay (mobile only) ──────────────────────────────── */}
        {sidebarOpen && (
          <div
            className="absolute inset-0 lg:hidden"
            style={{ background: 'rgba(0,0,0,0.55)', zIndex: 25 }}
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* ── Sidebar drawer ───────────────────────────────────────────────── */}
        <aside
          className={`sidebar-drawer ${sidebarOpen ? 'open' : 'closed'} w-64 glass flex flex-col overflow-y-auto flex-shrink-0`}
          style={{ borderRight: '1px solid rgba(255,255,255,0.08)' }}
        >
          {/* Close button (mobile only) */}
          <div className="flex items-center justify-between p-3 lg:hidden" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Menu</span>
            <button onClick={() => setSidebarOpen(false)} className="nav-link text-gray-500" style={{ padding: '4px 8px' }}>✕</button>
          </div>

          {/* GHL */}
          <div className="p-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
            <div className="flex items-center gap-2 mb-1">
              <span>⚡</span>
              <span className="text-sm font-semibold text-white">GoHighLevel</span>
              <span className="ml-auto badge-on text-xs px-2 py-0.5 rounded-full">Connected</span>
            </div>
            <p className="text-xs text-gray-500">CRM, contacts, workflows, blogs</p>
          </div>

          {/* Integrations — only show connected ones */}
          <div className="p-4 flex-1">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                Active Tools {connected.length > 0 && <span className="text-gray-600 normal-case font-normal">({connected.length})</span>}
              </span>
              <Link to="/settings" className="text-xs text-indigo-400 hover:text-indigo-300" onClick={() => setSidebarOpen(false)}>+ Connect</Link>
            </div>
            <div className="space-y-1.5">
              {!integrationsLoaded && (
                <div className="text-xs text-gray-600 text-center py-4">Loading…</div>
              )}
              {integrationsLoaded && connected.length === 0 && (
                <div className="text-xs text-gray-600 text-center py-4">No integrations connected yet</div>
              )}
              {sidebarItems.map(item => (
                <div
                  key={item.key}
                  className="flex items-center gap-2 px-2.5 py-2 rounded-xl"
                  style={{ background: 'rgba(255,255,255,0.03)' }}
                >
                  <span className="text-base flex-shrink-0">{item.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-white truncate">{item.label}</div>
                    {item.count != null
                      ? <div className="text-xs text-green-400">{item.count} connected</div>
                      : <div className="text-xs text-gray-600">{item.toolCount} tools</div>
                    }
                  </div>
                  <span className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-green-400" />
                </div>
              ))}
            </div>
            {connected.length === 0 && (
              <Link to="/settings" className="block mt-3 text-center text-xs text-indigo-400 hover:underline" onClick={() => setSidebarOpen(false)}>
                Connect your first integration →
              </Link>
            )}
          </div>

          {/* Links */}
          <div className="p-4" style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Quick links</p>
            <div className="space-y-1">
              {canAccess('campaign_builder') && <Link to="/campaign-builder" onClick={() => setSidebarOpen(false)} className="block text-xs text-gray-400 hover:text-indigo-400 py-1">🏗️ Campaign Builder</Link>}
              {canAccess('workflows')        && <Link to="/workflows"        onClick={() => setSidebarOpen(false)} className="block text-xs text-gray-400 hover:text-indigo-400 py-1">🔀 Workflow Builder</Link>}
              {canAccess('ads_generator')    && <Link to="/ads-generator"    onClick={() => setSidebarOpen(false)} className="block text-xs text-gray-400 hover:text-indigo-400 py-1">🎯 Bulk Ads Generator</Link>}
              {canAccess('social_planner')   && <Link to="/social"           onClick={() => setSidebarOpen(false)} className="block text-xs text-gray-400 hover:text-indigo-400 py-1">📱 Social Planner</Link>}
              {canAccess('ad_library')       && <Link to="/ad-library"       onClick={() => setSidebarOpen(false)} className="block text-xs text-gray-400 hover:text-indigo-400 py-1">📊 Ad Library Intel</Link>}
              {canAccess('settings')         && <Link to="/settings"         onClick={() => setSidebarOpen(false)} className="block text-xs text-gray-400 hover:text-indigo-400 py-1">⚙️ Integration Settings</Link>}
              <Link to="/brain" onClick={() => setSidebarOpen(false)} className="block text-xs text-gray-400 hover:text-indigo-400 py-1">🧠 Brain</Link>
            </div>
            {userRole && userRole !== 'owner' && (
              <p className="text-xs text-gray-600 mt-2">Role: <span className="text-gray-500 capitalize">{userRole}</span></p>
            )}
          </div>
        </aside>

        {/* ── Main ─────────────────────────────────────────────────────── */}
        <main className="flex-1 flex flex-col overflow-hidden">
          {/* Claude API key banner */}
          {!claudeReady && (
            <div
              className="flex items-center justify-between gap-3 px-4 py-2.5 flex-shrink-0"
              style={{ background: 'rgba(251,191,36,0.08)', borderBottom: '1px solid rgba(251,191,36,0.2)' }}
            >
              <div className="min-w-0">
                <span className="text-yellow-400 text-xs font-semibold">⚠️ AI provider required</span>
                <span className="text-gray-400 text-xs ml-1 hidden sm:inline">Add an API key in Settings (Anthropic, OpenAI, or Google Gemini).</span>
              </div>
              <button
                onClick={() => navigate('/settings')}
                className="btn-primary px-3 py-1.5 text-xs whitespace-nowrap flex-shrink-0"
              >
                Add Key →
              </button>
            </div>
          )}

          {/* Quick action chips — horizontal carousel */}
          <div
            className="chips-row flex-shrink-0 gap-2 px-3 py-2.5"
            style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', background: 'rgba(0,0,0,0.15)' }}
          >
            {QUICK_ACTIONS.map(({ label, prompt }) => (
              <button
                key={label}
                onClick={() => handleChip(prompt)}
                disabled={isRunning}
                className="text-xs px-3 py-1.5 rounded-full border transition-all flex-shrink-0"
                style={{
                  background: 'rgba(255,255,255,0.04)',
                  borderColor: 'rgba(255,255,255,0.08)',
                  color: '#9ca3af',
                  whiteSpace: 'nowrap',
                }}
                onMouseOver={e => { e.currentTarget.style.borderColor = '#6366f1'; e.currentTarget.style.color = '#a5b4fc'; }}
                onMouseOut={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; e.currentTarget.style.color = '#9ca3af'; }}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Stream output */}
          <StreamOutput
            messages={messages}
            isRunning={isRunning}
            placeholder={{
              icon: '🤖',
              text: 'Type a task below or click a quick action\nClaude will use all your connected tools automatically',
            }}
            voice={{ listening, supported: voiceSupported, toggle: toggleVoice, elapsed, liveText }}
          />

          {/* ── Prompt Library trigger + active persona bar ── */}
          <div className="flex items-center gap-2 px-3 py-2 flex-shrink-0"
            style={{ borderTop: '1px solid rgba(99,102,241,0.2)', background: 'rgba(99,102,241,0.06)' }}>
            <button onClick={() => setShowLibrary(v => !v)}
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-all"
              style={{ background: showLibrary ? 'rgba(99,102,241,0.3)' : 'rgba(99,102,241,0.12)', border: `1px solid ${showLibrary ? '#6366f1' : 'rgba(99,102,241,0.4)'}`, color: showLibrary ? '#c7d2fe' : '#a5b4fc' }}>
              📚 Prompt Library {library.length > 0 ? <span style={{ background: '#6366f1', color: '#fff', borderRadius: 10, padding: '0 6px', marginLeft: 4 }}>{library.reduce((a, f) => a + f.prompts.length, 0)}</span> : <span style={{ color: 'rgba(165,180,252,0.5)', fontWeight: 400 }}>· Save &amp; reuse prompts</span>}
            </button>
            {activePersona && (
              <div className="flex items-center gap-1.5 flex-1 min-w-0 text-xs px-3 py-1.5 rounded-lg"
                style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)', color: '#34d399' }}>
                <span>🧠</span>
                <span className="truncate font-medium">{activePersona.title}</span>
                <span className="text-gray-500 flex-shrink-0">active persona</span>
                <button onClick={() => setActivePersona(null)} className="ml-auto flex-shrink-0 text-gray-500 hover:text-red-400">×</button>
              </div>
            )}
            {task.trim() && activeFolder && (
              <button onClick={saveCurrentAsPrompt} title="Save current prompt to library"
                className="flex-shrink-0 text-xs px-2 py-1.5 rounded-lg text-gray-500 hover:text-indigo-400 transition-all"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
                💾 Save
              </button>
            )}
          </div>

          {/* ── Prompt Library panel ── */}
          {showLibrary && (
            <div className="flex-shrink-0 flex overflow-hidden" style={{ height: 320, borderTop: '1px solid rgba(99,102,241,0.2)', background: '#0c0c12' }}>
              {/* Left: folders */}
              <div className="flex flex-col flex-shrink-0 overflow-y-auto"
                style={{ width: 180, borderRight: '1px solid rgba(255,255,255,0.06)' }}>
                <div className="px-3 pt-3 pb-1 flex items-center justify-between">
                  <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Folders</span>
                  <button onClick={() => setShowNewFolder(v => !v)} className="text-indigo-400 text-xs hover:text-indigo-300">+</button>
                </div>
                {showNewFolder && (
                  <div className="px-2 pb-2 space-y-1">
                    <div className="flex gap-1">
                      {['📁','📣','🧠','💼','🎯','⚡','🚀','🌟'].map(ic => (
                        <button key={ic} onClick={() => setNewFolderIcon(ic)}
                          className="text-sm rounded px-1 py-0.5 transition-all"
                          style={{ background: newFolderIcon === ic ? 'rgba(99,102,241,0.3)' : 'transparent' }}>{ic}</button>
                      ))}
                    </div>
                    <input value={newFolderName} onChange={e => setNewFolderName(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && createFolder()}
                      placeholder="Folder name…" className="field w-full text-xs" />
                    <button onClick={createFolder} className="btn-primary text-xs w-full py-1">Create</button>
                  </div>
                )}
                {libLoading && <p className="text-xs text-gray-600 px-3 py-2">Loading…</p>}
                {library.length === 0 && !libLoading && (
                  <p className="text-xs text-gray-600 px-3 py-2">No folders yet.</p>
                )}
                {library.map(folder => (
                  <div key={folder.id}
                    onClick={() => {
                      setActiveFolder(folder.id);
                      setShowNewPrompt(false);
                      if (trainFolder !== folder.id) {
                        // Auto-load training session if a draft exists in this folder
                        const draft = folder.prompts?.find(p => p.isDraft);
                        if (draft) {
                          startTraining(folder.id, draft);
                        } else {
                          clearTrainSession();
                          autoSaveTrainingRef.current = null;
                          trainMsgsRef.current = [];
                          trainFolderRef.current = null;
                          setTrainFolder(null); setTrainPromptId(null); setTrainGenerated('');
                        }
                      }
                    }}
                    className="group flex items-center gap-2 px-3 py-2 cursor-pointer transition-all"
                    style={{ background: activeFolder === folder.id ? 'rgba(99,102,241,0.15)' : 'transparent', borderLeft: `2px solid ${activeFolder === folder.id ? '#6366f1' : 'transparent'}` }}>
                    <span className="text-base flex-shrink-0">{folder.icon}</span>
                    <span className="flex-1 text-xs text-gray-300 truncate">{folder.name}</span>
                    <button onClick={e => {
                        e.stopPropagation();
                        // If already training this folder, just switch to it — don't reset
                        if (trainFolder === folder.id) { setActiveFolder(folder.id); return; }
                        // Auto-resume existing draft if one exists in this folder
                        const draft = folder.prompts?.find(p => p.isDraft);
                        startTraining(folder.id, draft || null);
                      }}
                      title="Train a persona for this folder"
                      className="opacity-0 group-hover:opacity-100 text-xs px-1.5 py-0.5 rounded flex-shrink-0 transition-all"
                      style={{ background: 'rgba(168,85,247,0.2)', color: '#c084fc', border: '1px solid rgba(168,85,247,0.3)' }}>
                      🎓
                    </button>
                    <button onClick={e => { e.stopPropagation(); deleteFolder(folder.id); }}
                      className="opacity-0 group-hover:opacity-100 text-gray-600 hover:text-red-400 text-xs flex-shrink-0 transition-all">×</button>
                  </div>
                ))}
              </div>

              {/* Right: training mode OR prompts list */}
              <div className="flex-1 flex flex-col overflow-hidden">
                {trainFolder && activeFolder === trainFolder ? (
                  /* ── Persona Training Chat ── */
                  <div className="flex flex-col h-full">
                    <div className="flex items-center justify-between px-3 pt-3 pb-2 flex-shrink-0"
                      style={{ borderBottom: '1px solid rgba(168,85,247,0.2)', background: 'rgba(168,85,247,0.06)' }}>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold" style={{ color: '#c084fc' }}>🎓 Persona Training</span>
                        {trainPromptId && <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'rgba(16,185,129,0.15)', color: '#34d399', border: '1px solid rgba(16,185,129,0.3)' }}>Updating</span>}
                      </div>
                      <button onClick={exitTraining}
                        className="text-xs text-gray-500 hover:text-gray-300">✕ Exit</button>
                    </div>

                    {trainGenerated ? (
                      /* Generated persona — review + save */
                      <div className="flex-1 flex flex-col p-3 gap-2 overflow-y-auto">
                        <p className="text-xs font-semibold text-green-400">✓ Persona generated! Review and save:</p>
                        <textarea value={trainGenerated} onChange={e => setTrainGenerated(e.target.value)}
                          rows={8} className="field w-full text-xs flex-1" style={{ resize: 'none' }} />
                        <input value={trainSaveTitle} onChange={e => setTrainSaveTitle(e.target.value)}
                          placeholder="Persona name…" className="field w-full text-xs" />
                        <div className="flex gap-2">
                          <button onClick={saveTrainedPersona} className="btn-primary text-xs flex-1 py-1.5">
                            💾 {trainPromptId ? 'Update Persona' : 'Save Persona'}
                          </button>
                          <button onClick={() => { setTrainGenerated(''); }}
                            className="btn-ghost text-xs px-3 py-1.5">↩ Keep Training</button>
                        </div>
                      </div>
                    ) : (
                      /* Training chat */
                      <>
                        <div className="flex-1 overflow-y-auto p-3 space-y-3" style={{ minHeight: 0 }}>
                          {trainMsgs.length === 0 && (
                            <div className="text-xs text-gray-500 text-center py-6">
                              {trainPromptId
                                ? <>Continue refining this persona — add more context or adjustments.<br/><span className="text-gray-600">e.g. "Make the tone more casual" or "Also focus on email writing"</span></>
                                : <>Tell Claude what kind of persona you want to create.<br/><span className="text-gray-600">e.g. "I run a fitness coaching brand targeting women 30–45"</span></>
                              }
                            </div>
                          )}
                          {trainMsgs.map((m, i) => (
                            <div key={i}
                              className={`text-xs px-3 py-2 rounded-xl ${m.role === 'user' ? 'ml-auto' : 'mr-auto'}`}
                              style={{
                                maxWidth: '88%',
                                wordBreak: 'break-word',
                                whiteSpace: 'pre-wrap',
                                ...(m.role === 'user'
                                  ? { background: 'rgba(99,102,241,0.25)', color: '#c7d2fe', border: '1px solid rgba(99,102,241,0.3)' }
                                  : { background: 'rgba(255,255,255,0.07)', color: '#e2e8f0', border: '1px solid rgba(255,255,255,0.08)' }),
                              }}>
                              {m.role === 'assistant' && <span className="text-purple-400 font-semibold block mb-1 text-xs">🤖 Claude</span>}
                              {m.role === 'user'      && <span className="text-indigo-300 font-semibold block mb-1 text-xs">You</span>}
                              {m.content}
                            </div>
                          ))}
                          {trainLoading && (
                            <div className="text-xs px-3 py-2 rounded-xl mr-auto"
                              style={{ background: 'rgba(168,85,247,0.08)', border: '1px solid rgba(168,85,247,0.2)', color: '#c084fc' }}>
                              <span className="animate-pulse">🤖 AI is processing…</span>
                            </div>
                          )}
                          {/* Scroll anchor */}
                          <div ref={trainChatEndRef} />
                        </div>
                        <div className="flex-shrink-0 p-2 space-y-1.5" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                          <div className="flex gap-1.5">
                            <input value={trainInput} onChange={e => setTrainInput(e.target.value)}
                              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendTrainMsg()}
                              placeholder="Describe your persona, brand, tone…"
                              className="field flex-1 text-xs py-1.5" />
                            <button onClick={() => sendTrainMsg()} disabled={!trainInput.trim() || trainLoading}
                              className="btn-primary text-xs px-3 py-1.5 flex-shrink-0">
                              {trainLoading ? '…' : '▶ Process'}
                            </button>
                          </div>
                          {trainMsgs.length >= 3 && (
                            <button onClick={() => sendTrainMsg('finalize')} disabled={trainLoading}
                              className="w-full text-xs py-1.5 rounded-lg font-semibold transition-all"
                              style={{ background: 'rgba(168,85,247,0.2)', border: '1px solid rgba(168,85,247,0.4)', color: '#c084fc' }}>
                              ✨ Generate Persona
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                ) : !activeFolder ? (
                  <div className="flex items-center justify-center h-full text-xs text-gray-600">Select a folder</div>
                ) : (
                  <>
                    <div className="flex items-center justify-between px-3 pt-3 pb-1 flex-shrink-0">
                      <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                        {library.find(f => f.id === activeFolder)?.name}
                      </span>
                      <button onClick={() => setShowNewPrompt(v => !v)} className="text-xs text-indigo-400 hover:text-indigo-300">+ Add</button>
                    </div>
                    {showNewPrompt && (
                      <div className="px-3 pb-2 space-y-1.5 flex-shrink-0" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                        <input value={newPromptTitle} onChange={e => setNewPromptTitle(e.target.value)}
                          placeholder="Prompt title…" className="field w-full text-xs" />
                        <textarea value={newPromptBody} onChange={e => setNewPromptBody(e.target.value)}
                          placeholder="Prompt content / system instructions…"
                          rows={3} className="field w-full text-xs" style={{ resize: 'none' }} />
                        <div className="flex gap-1">
                          <button onClick={createPrompt} className="btn-primary text-xs flex-1 py-1">Save</button>
                          <button onClick={() => setShowNewPrompt(false)} className="btn-ghost text-xs flex-1 py-1">Cancel</button>
                        </div>
                      </div>
                    )}
                    <div className="flex-1 overflow-y-auto">
                      {(library.find(f => f.id === activeFolder)?.prompts || []).length === 0 && (
                        <p className="text-xs text-gray-600 px-3 py-3">No prompts yet. Click + Add.</p>
                      )}
                      {(library.find(f => f.id === activeFolder)?.prompts || []).map(p => (
                        <div key={p.id}
                          onClick={() => (p.isDraft || p.trainHistory?.length > 0) && startTraining(activeFolder, p)}
                          className="group px-3 py-2.5 transition-all"
                          style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', background: p.isDraft ? 'rgba(168,85,247,0.06)' : 'transparent', cursor: (p.isDraft || p.trainHistory?.length > 0) ? 'pointer' : 'default' }}>
                          <div className="flex items-start gap-2">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <p className="text-xs font-semibold truncate" style={{ color: p.isDraft ? '#c084fc' : '#fff' }}>{p.title}</p>
                                {p.isDraft
                                  ? <span className="text-xs flex-shrink-0 px-1 rounded" style={{ background: 'rgba(168,85,247,0.2)', color: '#c084fc', border: '1px solid rgba(168,85,247,0.3)' }}>draft · {Math.floor((p.trainHistory?.length || 0) / 2)} exchanges</span>
                                  : p.trainHistory?.length > 0 && <span title="Trained persona" className="text-xs flex-shrink-0" style={{ color: '#c084fc' }}>🎓</span>
                                }
                              </div>
                              <p className="text-xs mt-0.5" style={{ color: p.isDraft ? '#a855f7' : '#6b7280', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                                {p.isDraft ? 'Click to resume training conversation' : p.content}
                              </p>
                            </div>
                            <div className="flex flex-col gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-all">
                              {p.isDraft ? (
                                /* Draft: only show Resume and Delete */
                                <button onClick={e => { e.stopPropagation(); startTraining(activeFolder, p); }}
                                  className="text-xs px-2 py-0.5 rounded transition-all"
                                  style={{ background: 'rgba(168,85,247,0.2)', border: '1px solid rgba(168,85,247,0.4)', color: '#c084fc' }}>▶ Resume</button>
                              ) : (
                                <>
                                  <button onClick={() => usePrompt(p)}
                                    className="text-xs px-2 py-0.5 rounded text-indigo-400 hover:text-white transition-all"
                                    style={{ background: 'rgba(99,102,241,0.2)', border: '1px solid rgba(99,102,241,0.4)' }}>Use</button>
                                  <button onClick={() => setPersona(p)}
                                    className="text-xs px-2 py-0.5 rounded transition-all"
                                    style={{ background: activePersona?.id === p.id ? 'rgba(16,185,129,0.2)' : 'rgba(255,255,255,0.05)', border: `1px solid ${activePersona?.id === p.id ? 'rgba(16,185,129,0.5)' : 'rgba(255,255,255,0.1)'}`, color: activePersona?.id === p.id ? '#34d399' : '#9ca3af' }}>
                                    {activePersona?.id === p.id ? '✓ Set' : 'Persona'}</button>
                                  {p.trainHistory?.length > 0 && (
                                    <button onClick={() => startTraining(activeFolder, p)}
                                      className="text-xs px-2 py-0.5 rounded transition-all"
                                      style={{ background: 'rgba(168,85,247,0.15)', border: '1px solid rgba(168,85,247,0.35)', color: '#c084fc' }}>🎓 Train</button>
                                  )}
                                </>
                              )}
                              <button onClick={() => deletePrompt(activeFolder, p.id)}
                                className="text-xs px-2 py-0.5 rounded text-gray-600 hover:text-red-400 transition-all"
                                style={{ border: '1px solid rgba(255,255,255,0.08)' }}>Del</button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Input */}
          <div
            className="p-3 flex-shrink-0"
            style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}
          >
            {/* Listening indicator bar */}
            {listening && (
              <div
                className="flex items-center gap-2 mb-2 px-3 py-1.5 rounded-xl text-xs font-medium"
                style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171' }}
              >
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#ef4444', display: 'inline-block', animation: 'pulse 1s infinite' }} />
                Listening… speak your command, then pause to finish
              </div>
            )}

            <div className="flex gap-2 items-end">
              <div className="relative flex-1">
                {/* Slash command dropdown */}
                {slashOpen && (() => {
                  const filtered = SLASH_COMMANDS.filter(c =>
                    c.cmd.slice(1).includes(slashFilter) || c.label.toLowerCase().includes(slashFilter)
                  );
                  return filtered.length > 0 ? (
                    <div
                      className="absolute bottom-full mb-1 left-0 w-full rounded-xl overflow-hidden z-50"
                      style={{ background: '#1a1a2e', border: '1px solid rgba(99,102,241,0.3)', boxShadow: '0 -8px 24px rgba(0,0,0,0.4)' }}
                    >
                      {filtered.slice(0, 8).map(c => (
                        <button
                          key={c.cmd}
                          type="button"
                          onMouseDown={e => { e.preventDefault(); selectSlashCommand(c); }}
                          className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-indigo-600/20 transition-colors"
                        >
                          <code className="text-indigo-400 text-xs font-mono flex-shrink-0">{c.cmd}</code>
                          <span className="text-gray-400 text-xs truncate">{c.label}</span>
                        </button>
                      ))}
                    </div>
                  ) : null;
                })()}
                <textarea
                  ref={textareaRef}
                  value={task}
                  onChange={handleTaskChange}
                  onKeyDown={e => {
                    if (e.key === 'Escape') { setSlashOpen(false); return; }
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); }
                  }}
                  placeholder={listening ? 'Listening…' : 'Ask AI anything, or type / for commands…'}
                  rows={3}
                  className="field w-full text-sm leading-relaxed"
                  style={{ resize: 'none', paddingRight: voiceSupported ? '2.75rem' : undefined }}
                />
                {/* Mic button — inside textarea (bottom-right corner) */}
                {voiceSupported && (
                  <button
                    onClick={toggleVoice}
                    title={listening ? 'Stop recording' : 'Voice input'}
                    style={{
                      position: 'absolute',
                      bottom: '8px',
                      right: '10px',
                      width: 28,
                      height: 28,
                      borderRadius: '50%',
                      border: listening ? '1.5px solid #ef4444' : '1.5px solid rgba(255,255,255,0.15)',
                      background: listening ? 'rgba(239,68,68,0.18)' : 'rgba(255,255,255,0.06)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                      fontSize: 14,
                      animation: listening ? 'pulse 1s infinite' : 'none',
                    }}
                  >
                    {listening ? '⏹' : '🎤'}
                  </button>
                )}
              </div>

              <div className="flex flex-col gap-2 flex-shrink-0">
                <button
                  onClick={isRunning ? stop : handleSubmit}
                  disabled={!isRunning && !task.trim()}
                  className="btn-primary px-4 py-2.5 gap-2"
                >
                  {isRunning
                    ? <><span className="spinner w-4 h-4 rounded-full border-2" style={{ borderColor: 'rgba(255,255,255,0.3)', borderTopColor: '#fff' }} /> Stop</>
                    : '▶ Run'}
                </button>
                {messages.length > 0 && (
                  <button onClick={() => setMessages([])} className="btn-ghost px-3 py-1.5 text-xs">Clear</button>
                )}
              </div>
            </div>
            <div className="flex items-center justify-between mt-1.5">
              <p className="text-xs text-gray-600 hidden sm:block">
                Enter to run · Shift+Enter for new line · {voiceSupported ? '🎤 Click mic or ' : ''}AI chains tool calls automatically
              </p>
              <button
                type="button"
                onClick={() => { setTask('/'); setSlashOpen(true); setSlashFilter(''); setTimeout(() => textareaRef.current?.focus(), 0); }}
                className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors flex items-center gap-1 ml-auto"
                title="Browse slash commands"
              >
                <code className="font-mono">/</code> Commands
              </button>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
