/* ==========================================================================
   GLOBAL STATE MANAGEMENT & STORAGE
   ========================================================================== */

let chatSessions = JSON.parse(localStorage.getItem('career_chats')) || [];
let mentorSessions = JSON.parse(localStorage.getItem('mentor_history')) || [];
let courseSessions = JSON.parse(localStorage.getItem('course_history')) || [];
let appPreferences = JSON.parse(localStorage.getItem('app_prefs')) || { 
    defaultTab: 'explore', 
    autoArchive: true,
    model: 'llama-3.3-70b-versatile',
    customInstructions: ''
};

// Active Target Tracking
let activeCareerContext = "Data Analyst"; 
let currentActiveChatId = null;
let currentCourseSearchField = "";
let selectedRoadmapTitle = "Data Analyst";
let currentFetchedCourses = [];
let activeCourseFilter = 'all';

// Active Views & Inputs State
let currentView = 'explore';
let pendingImages = {
    exploreMain: null,
    exploreWs: null,
    mentor: null
};

let mentorMessages = [
    { sender: 'mentor', text: 'Welcome! Select a career pathway or ask me anything regarding resume feedback, interview prep, or skill building.' }
];

/* ==========================================================================
   FILE / IMAGE UPLOAD HANDLERS
   ========================================================================== */

/**
 * Reads a user-uploaded image/file and converts it to Base64 for local preview & storage
 */
function handleFileUpload(event, inputKey) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function (e) {
        pendingImages[inputKey] = e.target.result;
        renderImagePreview(inputKey);
    };
    reader.readAsDataURL(file);
}

/**
 * Displays a visual preview thumbnail of the attached image above/near the input
 */
function renderImagePreview(inputKey) {
    const containerId = `${inputKey}-preview-container`;
    let container = document.getElementById(containerId);

    if (!container) {
        console.warn(`Preview container #${containerId} not found in HTML.`);
        return;
    }

    if (pendingImages[inputKey]) {
        container.innerHTML = `
            <div class="relative inline-block mb-2 group">
                <img src="${pendingImages[inputKey]}" class="w-16 h-16 object-cover rounded-xl border border-gray-200 shadow-sm" />
                <button onclick="removeAttachedImage('${inputKey}')" class="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs shadow-md hover:bg-red-600 transition">✕</button>
            </div>
        `;
        container.classList.remove('hidden');
    } else {
        container.innerHTML = '';
        container.classList.add('hidden');
    }
}

/**
 * Removes the current attached file preview
 */
function removeAttachedImage(inputKey) {
    pendingImages[inputKey] = null;
    renderImagePreview(inputKey);
}

/* ==========================================================================
   BACKEND STREAMING API FETCHER (SSE SUPPORT)
   ========================================================================== */

/**
 * Universal Stream Fetcher communicating with backend FastAPI server (/api/chat)
 */
async function fetchBackendStreamCompletion(messagesArray, onChunkReceived) {
    const selectedModel = appPreferences.model || "llama-3.3-70b-versatile";

    try {
        const response = await fetch("/api/chat", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: selectedModel,
                messages: messagesArray
            })
        });

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.detail || errData.error || `HTTP error! Status: ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let fullText = "";

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split("\n");

            for (const line of lines) {
                if (line.startsWith("data: ")) {
                    const rawData = line.replace("data: ", "");
                    const cleanedData = rawData.replace(/\\n/g, "\n");
                    fullText += cleanedData;
                    if (onChunkReceived) {
                        onChunkReceived(fullText);
                    }
                }
            }
        }

        return fullText || "No response generated.";

    } catch (err) {
        console.error("Backend API Error:", err);
        return `⚠️ **Error connecting to server:** ${err.message}`;
    }
}

/* ==========================================================================
   SYSTEM PROMPTS (EXPLORE vs MENTOR)
   ========================================================================== */

/**
 * Explore Tab Prompt: General, flexible AI like Gemini/ChatGPT.
 */
function getExploreSystemPrompt() {
    const customInstr = appPreferences.customInstructions ? `\nUser Preferences: ${appPreferences.customInstructions}` : '';
    
    return `You are an intelligent, versatile AI assistant (like Gemini or ChatGPT).
Your goal is to help the user with whatever they ask — whether it's general knowledge, brainstorming, coding, career ideas, technical questions, or casual conversation.${customInstr}

INSTRUCTIONS:
1. Be natural, helpful, engaging, and clear.
2. Adapt to the user's tone. If they just say "hi", greet them warmly and ask how you can help.
3. Do NOT force inputs into a "career field" template if the user didn't explicitly ask for career guidance.
4. Use clear Markdown formatting with bolding and bullet points where helpful.`;
}

/**
 * Mentor Tab Prompt: Study & Career specific coach.
 */
function getMentorSystemPrompt(careerContext) {
    const context = careerContext || "Data Analyst";
    const customInstr = appPreferences.customInstructions ? `\nUser Preferences: ${appPreferences.customInstructions}` : '';
    
    return `You are a dedicated Career & Study Mentor strictly guiding the user on their path to becoming a "${context}".${customInstr}

STRICT ROLE RULES:
1. FOCUS ON LEARNING & CAREER: Your primary job is to help with study roadmaps, skill building, resume feedback, interview prep, and technical practice for "${context}".
2. OFF-TOPIC / DISTRACTION REDIRECTION: If the user starts talking about non-related topics (like movies, casual banter, general trivia, games, or off-topic chatter), gently bring them back to their study goals.
3. BREAK SUGGESTION: Explicitly tell them: "If you want to take a break or chat about real-world conversations, feel free to switch over to the Explore tab! Otherwise, let's keep making progress on your ${context} roadmap."
4. Be encouraging, structured, and goal-oriented. Keep formatting clean with bullet points and bold key concepts.`;
}

/* ==========================================================================
   INITIALIZATION & EVENT LISTENERS
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
    initTypingEffect();
    
    if (appPreferences.defaultTab && appPreferences.defaultTab !== 'explore') {
        switchView(appPreferences.defaultTab);
    }
});

/* ==========================================================================
   NAVIGATION & VIEW SWITCHING
   ========================================================================== */

function switchView(targetKey) {
    currentView = targetKey;

    if (appPreferences.autoArchive && targetKey !== 'chat' && mentorMessages.length > 1) {
        autoArchiveMentorChat();
    }

    const views = ['explore', 'roadmap', 'chat', 'courses'];
    
    views.forEach(key => {
        const panel = document.getElementById(`view-${key}`);
        const tabButton = document.getElementById(`tab-${key}`);

        if (!panel) return;

        if (key === targetKey) {
            panel.classList.remove('hidden', 'opacity-0', 'pointer-events-none');
            panel.classList.add('opacity-100', 'translate-y-0');
            if (tabButton) tabButton.className = "px-5 py-2 rounded-full text-sm font-semibold transition active:scale-95 bg-[#199A8E] text-white shadow-sm";
        } else {
            panel.classList.add('opacity-0', 'pointer-events-none', 'hidden');
            panel.classList.remove('opacity-100', 'translate-y-0');
            if (tabButton) tabButton.className = "px-5 py-2 rounded-full text-sm font-semibold transition active:scale-95 text-[#5C7270] hover:bg-white/50";
        }
    });

    if (targetKey === 'explore' && currentActiveChatId) {
        const activeSession = chatSessions.find(s => s.id === currentActiveChatId);
        if (activeSession) renderExploreChatMessages(activeSession);
    }
}

function openMentorChatTab() {
    switchView('chat');
    renderMentorChatMessages();
}

/* ==========================================================================
   EXPLORE WORKSPACE CONTROLLERS (GENERAL AI)
   ========================================================================== */

async function handleSearchSubmission() {
    const textarea = document.getElementById('terminal-input');
    const promptText = textarea ? textarea.value.trim() : '';
    const imageAttachment = pendingImages.exploreMain;

    if (!promptText && !imageAttachment) return;

    activeCareerContext = promptText || "General Exploration";

    const newSession = {
        id: 'chat-' + Date.now(),
        title: promptText.length > 28 ? promptText.slice(0, 28) + '...' : (promptText || 'Image Inquiry'),
        date: 'Just now',
        messages: [
            { sender: 'user', text: promptText, imageUrl: imageAttachment },
            { sender: 'mentor', text: 'Thinking...' }
        ]
    };

    chatSessions.unshift(newSession);
    localStorage.setItem('career_chats', JSON.stringify(chatSessions));
    currentActiveChatId = newSession.id;

    if (textarea) textarea.value = '';
    removeAttachedImage('exploreMain');

    expandExploreWorkspace(newSession);

    const payload = [
        { role: "system", content: getExploreSystemPrompt() },
        { role: "user", content: promptText + (imageAttachment ? " [Attached File/Image Reference]" : "") }
    ];

    const aiResponse = await fetchBackendStreamCompletion(payload, (streamedText) => {
        newSession.messages[1].text = streamedText;
        renderExploreChatMessages(newSession);
    });

    newSession.messages[1].text = aiResponse;
    localStorage.setItem('career_chats', JSON.stringify(chatSessions));
    renderExploreChatMessages(newSession);
}

function expandExploreWorkspace(session) {
    const card = document.getElementById('explore-prompt-card');
    const compactView = document.getElementById('explore-compact-view');
    const expandedWorkspace = document.getElementById('explore-expanded-workspace');
    const headerText = document.getElementById('explore-header-text');

    if (card) {
        card.classList.remove('max-w-2xl');
        card.classList.add('max-w-4xl', 'p-6');
    }
    if (headerText) headerText.classList.add('hidden');
    if (compactView) compactView.classList.add('hidden');
    if (expandedWorkspace) expandedWorkspace.classList.remove('hidden');

    const titleEl = document.getElementById('workspace-thread-title');
    if (titleEl) titleEl.innerText = session.title;
    
    renderExploreChatMessages(session);
}

function collapseExploreWorkspace() {
    const card = document.getElementById('explore-prompt-card');
    const compactView = document.getElementById('explore-compact-view');
    const expandedWorkspace = document.getElementById('explore-expanded-workspace');
    const headerText = document.getElementById('explore-header-text');

    if (card) {
        card.classList.remove('max-w-4xl', 'p-6');
        card.classList.add('max-w-2xl');
    }
    if (headerText) headerText.classList.remove('hidden');
    if (expandedWorkspace) expandedWorkspace.classList.add('hidden');
    if (compactView) compactView.classList.remove('hidden');

    currentActiveChatId = null;
}

function renderExploreChatMessages(session) {
    const container = document.getElementById('explore-chat-messages');
    if (!container) return;

    container.innerHTML = session.messages.map(msg => {
        let imgHtml = msg.imageUrl ? `<img src="${msg.imageUrl}" class="max-w-xs max-h-48 rounded-xl border border-gray-200 mb-2 object-cover"/>` : '';
        return `
            <div class="w-full text-${msg.sender === 'user' ? 'right' : 'left'} my-2">
                <div class="${msg.sender === 'user' ? 'bg-[#199A8E] text-white' : 'bg-[#F0F7F7] text-[#1A3330]'} max-w-[85%] p-4 rounded-2xl text-xs leading-relaxed font-medium inline-block text-left shadow-sm">
                    ${imgHtml}
                    <div>${formatMarkdownToHTML(msg.text)}</div>
                </div>
            </div>
        `;
    }).join('');

    container.scrollTop = container.scrollHeight;
}

async function sendExploreWorkspaceMessage() {
    const input = document.getElementById('explore-chat-input');
    const text = input ? input.value.trim() : '';
    const imageAttachment = pendingImages.exploreWs;

    if ((!text && !imageAttachment) || !currentActiveChatId) return;

    const session = chatSessions.find(s => s.id === currentActiveChatId);
    if (!session) return;

    session.messages.push({ sender: 'user', text: text, imageUrl: imageAttachment });
    session.messages.push({ sender: 'mentor', text: 'Thinking...' });

    if (input) input.value = "";
    removeAttachedImage('exploreWs');

    localStorage.setItem('career_chats', JSON.stringify(chatSessions));
    renderExploreChatMessages(session);

    const payload = [
        { role: "system", content: getExploreSystemPrompt() }
    ];

    session.messages.slice(0, -1).forEach(m => {
        payload.push({
            role: m.sender === 'user' ? 'user' : 'assistant',
            content: m.text + (m.imageUrl ? " [Attached File/Image Reference]" : "")
        });
    });

    const aiResponse = await fetchBackendStreamCompletion(payload, (streamedText) => {
        session.messages[session.messages.length - 1].text = streamedText;
        renderExploreChatMessages(session);
    });

    session.messages[session.messages.length - 1].text = aiResponse;
    localStorage.setItem('career_chats', JSON.stringify(chatSessions));
    renderExploreChatMessages(session);
}

/* ==========================================================================
   MENTOR CHAT CONTROLLERS (STUDY SPECIFIC)
   ========================================================================== */

function renderMentorChatMessages() {
    const container = document.getElementById('mentor-chat-messages');
    if (!container) return;

    container.innerHTML = mentorMessages.map(msg => {
        let imgHtml = msg.imageUrl ? `<img src="${msg.imageUrl}" class="max-w-xs max-h-48 rounded-xl border border-gray-200 mb-2 object-cover"/>` : '';
        return `
            <div class="w-full text-${msg.sender === 'user' ? 'right' : 'left'} my-2">
                <div class="${msg.sender === 'user' ? 'bg-[#199A8E] text-white' : 'bg-[#F0F7F7] text-[#1A3330]'} max-w-[85%] p-4 rounded-2xl text-xs leading-relaxed font-medium inline-block text-left shadow-sm">
                    ${imgHtml}
                    <div>${formatMarkdownToHTML(msg.text)}</div>
                </div>
            </div>
        `;
    }).join('');

    container.scrollTop = container.scrollHeight;
}

async function sendMentorDirectMessage() {
    const input = document.getElementById('mentor-input');
    const userText = input ? input.value.trim() : '';
    const imageAttachment = pendingImages.mentor;

    if (!userText && !imageAttachment) return;

    const currentContext = selectedRoadmapTitle || activeCareerContext || "Data Analyst";

    mentorMessages.push({ sender: 'user', text: userText, imageUrl: imageAttachment });
    mentorMessages.push({ sender: 'mentor', text: 'Thinking...' });

    if (input) input.value = "";
    removeAttachedImage('mentor');

    renderMentorChatMessages();

    const payload = [
        { role: "system", content: getMentorSystemPrompt(currentContext) }
    ];

    mentorMessages.slice(0, -1).forEach(m => {
        payload.push({
            role: m.sender === 'user' ? 'user' : 'assistant',
            content: m.text + (m.imageUrl ? " [Attached File/Image Reference]" : "")
        });
    });

    const aiResponse = await fetchBackendStreamCompletion(payload, (streamedText) => {
        mentorMessages[mentorMessages.length - 1].text = streamedText;
        renderMentorChatMessages();
    });

    mentorMessages[mentorMessages.length - 1].text = aiResponse;
    renderMentorChatMessages();
}

function exitAndArchiveMentorChat() {
    if (mentorMessages.length > 1) {
        autoArchiveMentorChat();
    }
    resetMentorChat();
    switchView('explore');
}

function autoArchiveMentorChat() {
    const userMsgs = mentorMessages.filter(m => m.sender === 'user');
    const context = selectedRoadmapTitle || activeCareerContext || "Data Analyst";
    const title = userMsgs.length > 0 ? (userMsgs[0].text.length > 25 ? userMsgs[0].text.slice(0, 25) + '...' : userMsgs[0].text) : `Mentor (${context})`;

    const newSession = {
        id: 'mentor-' + Date.now(),
        title: title,
        date: 'Just now',
        messages: [...mentorMessages]
    };

    mentorSessions.unshift(newSession);
    localStorage.setItem('mentor_history', JSON.stringify(mentorSessions));
    resetMentorChat();
}

function resetMentorChat() {
    const currentContext = selectedRoadmapTitle || activeCareerContext || "Data Analyst";
    mentorMessages = [
        { sender: 'mentor', text: `Welcome! We are now focusing on your **${currentContext}** roadmap. How can I assist you today?` }
    ];
    renderMentorChatMessages();
}

/* ==========================================================================
   ROADMAP DATA & GENERATOR (COMPLETE 4-STEP ROADMAPS)
   ========================================================================== */

const careerDataMap = {
    "Data Analyst": {
        tag: "chart",
        description: "Turn raw numbers into decisions — data analysts explore, clean, and visualize data so teams know what to do next.",
        steps: [
            { title: "Learn spreadsheets and SQL basics", desc: "Get comfortable with formulas, pivot tables, and SQL SELECT/JOIN queries." },
            { title: "Pick up Python or R for analysis", desc: "Learn pandas (Python) or dplyr (R) to clean and manipulate real datasets." },
            { title: "Build data visualizations", desc: "Practice with tools like Tableau, Power BI, or Matplotlib." },
            { title: "Do a portfolio project", desc: "Analyze a public dataset end-to-end and publish your findings." }
        ]
    },
    "Software Developer": {
        tag: "code",
        description: "Design, build, and maintain applications — from web apps to mobile apps to backend systems.",
        steps: [
            { title: "Master programming foundations", desc: "Pick Python, JavaScript, or Java and learn variables, loops, and logic." },
            { title: "Learn Git and version control", desc: "Track project versions, manage commits, and collaborate using GitHub." },
            { title: "Databases and API endpoints", desc: "Understand how backend servers transmit and store dynamic records." },
            { title: "Full-Stack Deployment", desc: "Host fully built functional systems safely online on cloud platforms." }
        ]
    },
    "Nurse": {
        tag: "heart",
        description: "Provide direct, hands-on care to patients — blending science, empathy, and critical thinking.",
        steps: [
            { title: "Prerequisites & Anatomy Foundations", desc: "Complete coursework in anatomy, physiology, microbiology, and chemistry." },
            { title: "Earn Nursing Degree (ADN or BSN)", desc: "Enroll in an accredited program and complete rigorous clinical rotations." },
            { title: "Pass the NCLEX-RN Exam", desc: "Pass the national licensure examination to become a Registered Nurse." },
            { title: "Specialization & Advanced Practice", desc: "Gain hospital experience in ER/ICU or pursue MSN for Nurse Practitioner roles." }
        ]
    },
    "Literature & Writing": {
        tag: "book",
        description: "Study, interpret, and create written work — toward writing, editing, or publishing careers.",
        steps: [
            { title: "Focus Specialization & Analysis", desc: "Refine syntax structures across technical writing, creative prose, or journalism." },
            { title: "Master Style Guides & Editing", desc: "Learn industry standards including Chicago, MLA, APA, and copyediting tools." },
            { title: "Build Portfolio Archive", desc: "Publish short stories, essays, technical docs, or articles across digital media." },
            { title: "Pitching & Publication Strategy", desc: "Learn query letter crafting, agent pitching, self-publishing, or freelance marketing." }
        ]
    },
    "UX Designer": {
        tag: "palette",
        description: "Shape how digital products feel — researching user needs and designing intuitive interfaces.",
        steps: [
            { title: "UX Fundamentals & Research", desc: "Learn user psychology, wireframing basics, and qualitative user interviewing." },
            { title: "Figma Prototyping & UI Tools", desc: "Master Figma, design systems, auto-layout, and interactive micro-animations." },
            { title: "Usability Testing & Iteration", desc: "Conduct A/B testing, gather user feedback, and refine user journey flows." },
            { title: "Case Study & Portfolio Creation", desc: "Document end-to-end design problems, solutions, and wireframes into a portfolio." }
        ]
    },
    "Financial Analyst": {
        tag: "coins",
        description: "Evaluate financial data to guide investment, budgeting, and business decisions.",
        steps: [
            { title: "Financial Accounting Core", desc: "Learn to read and construct income statements, balance sheets, and cash flow charts." },
            { title: "Excel & Financial Modeling", desc: "Build discounted cash flow (DCF) models, LBO models, and valuation frameworks." },
            { title: "Market & Data Analytics", desc: "Use Python, SQL, or Bloomberg Terminal data to evaluate macroeconomic trends." },
            { title: "Certifications & Pitching", desc: "Prepare for the CFA exam and deliver investment memo recommendations." }
        ]
    }
};

function generateRoadmap(careerKey) {
    const data = careerDataMap[careerKey] || {
        tag: 'path',
        description: `Comprehensive guide for ${careerKey}.`,
        steps: [
            { title: '1. Fundamentals', desc: 'Master core concepts required for this path.' },
            { title: '2. Practical Skills', desc: 'Build hands-on projects and portfolio items.' }
        ]
    };

    selectedRoadmapTitle = careerKey;
    activeCareerContext = careerKey;

    document.getElementById('roadmap-title').innerText = careerKey;
    document.getElementById('roadmap-tag').innerText = data.tag;
    document.getElementById('roadmap-description').innerText = data.description;

    const stepsMount = document.getElementById('roadmap-steps-mount');
    stepsMount.innerHTML = "";

    data.steps.forEach((step, index) => {
        stepsMount.innerHTML += `
            <div class="relative mb-6">
                <div class="absolute -left-[41px] top-1 w-5 h-5 rounded-full bg-[#199A8E] text-white flex items-center justify-center text-[10px] font-bold shadow-sm border-2 border-white">
                    ${index + 1}
                </div>
                <div class="bg-white border border-gray-100 p-5 rounded-2xl shadow-sm hover:border-[#199A8E]/30 transition">
                    <h4 class="text-sm font-bold text-[#1A3330] mb-1">${step.title}</h4>
                    <p class="text-xs text-[#5C7270] leading-relaxed">${step.desc}</p>
                </div>
            </div>
        `;
    });

    switchView('roadmap');
}

function closeRoadmapView() {
    switchView('explore');
}

function launchInteractiveMentorWorkspace() {
    const title = selectedRoadmapTitle || activeCareerContext || "Data Analyst";
    activeCareerContext = title;

    mentorMessages = [
        {
            sender: 'mentor',
            text: `Welcome! We are now focusing on your **${title}** roadmap. I can help you prepare for interviews, review required skills, or set up weekly action items. What area shall we start with?`
        }
    ];
    openMentorChatTab();
}

/* ==========================================================================
   COURSES SEARCH & FILTERING
   ========================================================================== */

async function fetchDemandedCourses() {
    const fieldInput = document.getElementById('course-field-input');
    const field = fieldInput ? fieldInput.value.trim() : '';
    const mount = document.getElementById('course-results-mount');

    if (!field) {
        alert('Please enter a field name.');
        return;
    }

    currentCourseSearchField = field;
    activeCareerContext = field; 

    const exitBtn = document.getElementById('exit-course-btn');
    if (exitBtn) exitBtn.classList.remove('hidden');

    mount.innerHTML = `
        <div class="flex flex-col items-center justify-center py-12 space-y-3">
            <div class="w-8 h-8 border-4 border-[#199A8E] border-t-transparent rounded-full animate-spin"></div>
            <p class="text-xs font-semibold text-[#5C7270]">Fetching top courses for "${field}"...</p>
        </div>
    `;

    setTimeout(() => {
        currentFetchedCourses = generateCoursesForField(field);
        renderCoursesList();
    }, 600);
}

function generateCoursesForField(field) {
    const cleanField = field.trim();
    return [
        {
            title: `Google Professional ${cleanField} Certificate`,
            platform: "Coursera",
            type: "paid",
            rating: "4.8 ★",
            description: `Industry-recognized professional certification covering foundational to advanced hands-on ${cleanField} workflows.`,
            link: `https://www.coursera.org/search?query=${encodeURIComponent(cleanField)}`
        },
        {
            title: `Complete ${cleanField} Masterclass 2026`,
            platform: "Udemy",
            type: "paid",
            rating: "4.7 ★",
            description: `All-in-one project-driven roadmap tailored for beginners and intermediate professionals in ${cleanField}.`,
            link: `https://www.udemy.com/courses/search/?q=${encodeURIComponent(cleanField)}`
        },
        {
            title: `FreeCodeCamp: ${cleanField} Full Course`,
            platform: "YouTube / freeCodeCamp",
            type: "free",
            rating: "4.9 ★",
            description: `Completely free zero-to-hero video tutorial and practical lab guide covering modern ${cleanField} concepts.`,
            link: `https://www.youtube.com/results?search_query=freecodecamp+${encodeURIComponent(cleanField)}`
        },
        {
            title: `MIT OpenCourseWare: Introduction to ${cleanField}`,
            platform: "edX / MIT",
            type: "free",
            rating: "4.9 ★",
            description: `Academic grade learning material and lecture notes provided directly from university faculty.`,
            link: `https://www.edx.org/search?q=${encodeURIComponent(cleanField)}`
        }
    ];
}

function filterCourseCategory(category) {
    activeCourseFilter = category;
    ['all', 'paid', 'free'].forEach(cat => {
        const btn = document.getElementById(`filter-${cat}`);
        if (btn) {
            btn.className = (cat === category) 
                ? "px-3 py-1.5 rounded-lg bg-[#199A8E] text-white shrink-0"
                : "px-3 py-1.5 rounded-lg text-[#5C7270] hover:bg-gray-100 shrink-0";
        }
    });
    renderCoursesList();
}

function renderCoursesList() {
    const mount = document.getElementById('course-results-mount');
    if (!mount) return;

    if (!currentFetchedCourses || currentFetchedCourses.length === 0) {
        mount.innerHTML = `<p class="text-xs text-gray-400 italic text-center py-6">No courses found.</p>`;
        return;
    }

    let filtered = currentFetchedCourses;
    if (activeCourseFilter === 'paid') filtered = currentFetchedCourses.filter(c => c.type === 'paid');
    if (activeCourseFilter === 'free') filtered = currentFetchedCourses.filter(c => c.type === 'free');

    mount.innerHTML = filtered.map(course => `
        <div class="bg-white border border-gray-100 p-5 rounded-2xl hover:border-[#199A8E]/40 hover:shadow-sm transition flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div class="space-y-1.5 max-w-xl">
                <div class="flex items-center gap-2">
                    <span class="text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-md ${course.type === 'free' ? 'bg-emerald-50 text-emerald-600 border border-emerald-200' : 'bg-blue-50 text-blue-600 border border-blue-200'}">
                        ${course.type}
                    </span>
                    <span class="text-xs font-semibold text-[#889C9A]">● ${course.platform}</span>
                    <span class="text-xs font-bold text-amber-500">${course.rating}</span>
                </div>
                <h3 class="font-bold text-[#1A3330] text-sm">${course.title}</h3>
                <p class="text-xs text-[#5C7270] leading-relaxed">${course.description}</p>
            </div>
            <a href="${course.link}" target="_blank" class="bg-[#F0F7F7] hover:bg-[#199A8E] text-[#199A8E] hover:text-white px-4 py-2.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 shrink-0 shadow-sm">
                <span>View Course</span>
            </a>
        </div>
    `).join('');
}

function exitAndArchiveCourseSearch() {
    if (currentCourseSearchField && currentFetchedCourses.length > 0) {
        courseSessions.unshift({
            id: 'course-' + Date.now(),
            field: currentCourseSearchField,
            date: 'Just now',
            courses: [...currentFetchedCourses]
        });
        localStorage.setItem('course_history', JSON.stringify(courseSessions));
    }

    currentCourseSearchField = "";
    currentFetchedCourses = [];
    
    const input = document.getElementById('course-field-input');
    if (input) input.value = "";

    const exitBtn = document.getElementById('exit-course-btn');
    if (exitBtn) exitBtn.classList.add('hidden');

    const mount = document.getElementById('course-results-mount');
    if (mount) mount.innerHTML = `<p class="text-xs text-gray-400 italic text-center py-8">Enter a field above and click "Find Courses" to view results.</p>`;

    switchView('explore');
}

/* ==========================================================================
   SIDEBAR HISTORY & DELETION HANDLERS
   ========================================================================== */

function toggleSidebar() {
    const sidebar = document.getElementById('sidebar-menu');
    const overlay = document.getElementById('sidebar-overlay');
    if (!sidebar || !overlay) return;
    
    if (sidebar.classList.contains('-translate-x-full')) {
        renderCategorizedSidebarHistory();
        sidebar.classList.remove('-translate-x-full');
        overlay.classList.remove('hidden');
        setTimeout(() => overlay.classList.add('opacity-100'), 10);
    } else {
        sidebar.classList.add('-translate-x-full');
        overlay.classList.remove('opacity-100');
        setTimeout(() => overlay.classList.add('hidden'), 300);
    }
}

function renderCategorizedSidebarHistory() {
    const container = document.getElementById('sidebar-history-sections');
    if (!container) return;

    let html = "";

    // Explore Workspaces
    html += `
        <div class="space-y-2">
            <div class="flex items-center gap-1.5 px-1 text-[#1A3330] font-bold text-[11px] uppercase tracking-wider">
                <span>Explore Workspaces</span>
            </div>
    `;
    if (chatSessions.length === 0) {
        html += `<p class="text-[11px] text-gray-400 italic px-2">No past workspace sessions.</p>`;
    } else {
        html += chatSessions.map(session => `
            <div class="group relative flex items-center justify-between p-2.5 border border-gray-100 rounded-xl hover:border-[#199A8E] hover:bg-[#F0F7F7] transition bg-white cursor-pointer" onclick="resumeExploreChatFromSidebar('${session.id}')">
                <div class="space-y-0.5 overflow-hidden pr-5">
                    <h4 class="font-bold text-[#1A3330] text-xs truncate">${session.title}</h4>
                    <div class="text-[10px] text-[#889C9A]">${session.messages.length} msgs • ${session.date}</div>
                </div>
                <button onclick="deleteExploreSession(event, '${session.id}')" title="Delete Session" class="p-1 text-gray-400 hover:text-red-500 rounded-lg transition">✕</button>
            </div>
        `).join('');
    }
    html += `</div>`;

    // Mentor Sessions
    html += `
        <div class="space-y-2 pt-2">
            <div class="flex items-center gap-1.5 px-1 text-[#1A3330] font-bold text-[11px] uppercase tracking-wider">
                <span>Mentor Coaching Sessions</span>
            </div>
    `;
    if (mentorSessions.length === 0) {
        html += `<p class="text-[11px] text-gray-400 italic px-2">No saved mentor sessions.</p>`;
    } else {
        html += mentorSessions.map(session => `
            <div class="group relative flex items-center justify-between p-2.5 border border-gray-100 rounded-xl hover:border-[#199A8E] hover:bg-[#F0F7F7] transition bg-white cursor-pointer" onclick="resumeMentorSessionFromSidebar('${session.id}')">
                <div class="space-y-0.5 overflow-hidden pr-5">
                    <h4 class="font-bold text-[#1A3330] text-xs truncate">${session.title}</h4>
                    <div class="text-[10px] text-[#889C9A]">${session.messages.length} msgs • ${session.date}</div>
                </div>
                <button onclick="deleteMentorSession(event, '${session.id}')" title="Delete Session" class="p-1 text-gray-400 hover:text-red-500 rounded-lg transition">✕</button>
            </div>
        `).join('');
    }
    html += `</div>`;

    // Saved Course Searches
    html += `
        <div class="space-y-2 pt-2">
            <div class="flex items-center gap-1.5 px-1 text-[#1A3330] font-bold text-[11px] uppercase tracking-wider">
                <span>Saved Course Searches</span>
            </div>
    `;
    if (courseSessions.length === 0) {
        html += `<p class="text-[11px] text-gray-400 italic px-2">No saved course searches.</p>`;
    } else {
        html += courseSessions.map(session => `
            <div class="group relative flex items-center justify-between p-2.5 border border-gray-100 rounded-xl hover:border-[#199A8E] hover:bg-[#F0F7F7] transition bg-white cursor-pointer" onclick="resumeCourseSearchFromSidebar('${session.id}')">
                <div class="space-y-0.5 overflow-hidden pr-5">
                    <h4 class="font-bold text-[#1A3330] text-xs truncate">${session.field}</h4>
                    <div class="text-[10px] text-[#889C9A]">${session.courses.length} courses • ${session.date}</div>
                </div>
                <button onclick="deleteCourseSession(event, '${session.id}')" title="Delete Search" class="p-1 text-gray-400 hover:text-red-500 rounded-lg transition">✕</button>
            </div>
        `).join('');
    }
    html += `</div>`;

    container.innerHTML = html;
}

function deleteExploreSession(event, sessionId) {
    event.stopPropagation();
    chatSessions = chatSessions.filter(s => s.id !== sessionId);
    localStorage.setItem('career_chats', JSON.stringify(chatSessions));
    if (currentActiveChatId === sessionId) collapseExploreWorkspace();
    renderCategorizedSidebarHistory();
}

function deleteMentorSession(event, sessionId) {
    event.stopPropagation();
    mentorSessions = mentorSessions.filter(s => s.id !== sessionId);
    localStorage.setItem('mentor_history', JSON.stringify(mentorSessions));
    renderCategorizedSidebarHistory();
}

function deleteCourseSession(event, sessionId) {
    event.stopPropagation();
    courseSessions = courseSessions.filter(s => s.id !== sessionId);
    localStorage.setItem('course_history', JSON.stringify(courseSessions));
    renderCategorizedSidebarHistory();
}

function resumeExploreChatFromSidebar(sessionId) {
    const session = chatSessions.find(s => s.id === sessionId);
    if (!session) return;
    currentActiveChatId = session.id;
    toggleSidebar();
    switchView('explore');
    expandExploreWorkspace(session);
}

function resumeMentorSessionFromSidebar(sessionId) {
    const session = mentorSessions.find(s => s.id === sessionId);
    if (!session) return;
    mentorMessages = session.messages;
    toggleSidebar();
    openMentorChatTab();
}

function resumeCourseSearchFromSidebar(sessionId) {
    const session = courseSessions.find(s => s.id === sessionId);
    if (!session) return;
    
    currentCourseSearchField = session.field;
    currentFetchedCourses = session.courses;
    activeCareerContext = session.field;
    
    toggleSidebar();
    switchView('courses');

    const input = document.getElementById('course-field-input');
    if (input) input.value = session.field;

    const exitBtn = document.getElementById('exit-course-btn');
    if (exitBtn) exitBtn.classList.remove('hidden');

    renderCoursesList();
}

/* ==========================================================================
   SETTINGS & PREFERENCES
   ========================================================================== */

function openSettingsModal() {
    toggleSidebar();
    const modal = document.getElementById('settings-modal');
    if (!modal) return;
    modal.classList.remove('hidden');
    setTimeout(() => modal.classList.add('opacity-100'), 10);

    const selectTab = document.getElementById('setting-default-tab');
    const autoArchive = document.getElementById('setting-auto-archive');
    const modelSelect = document.getElementById('setting-ai-model');
    const customInstructions = document.getElementById('setting-custom-instructions');

    if (selectTab) selectTab.value = appPreferences.defaultTab || 'explore';
    if (autoArchive) autoArchive.checked = appPreferences.autoArchive !== false;
    if (modelSelect) modelSelect.value = appPreferences.model || 'llama-3.3-70b-versatile';
    if (customInstructions) customInstructions.value = appPreferences.customInstructions || '';
}

function closeSettingsModal() {
    const modal = document.getElementById('settings-modal');
    if (!modal) return;
    modal.classList.remove('opacity-100');
    setTimeout(() => modal.classList.add('hidden'), 300);
}

function saveAppPreferences() {
    const defaultTabEl = document.getElementById('setting-default-tab');
    const autoArchiveEl = document.getElementById('setting-auto-archive');
    const modelEl = document.getElementById('setting-ai-model');
    const customInstructionsEl = document.getElementById('setting-custom-instructions');

    appPreferences.defaultTab = defaultTabEl ? defaultTabEl.value : 'explore';
    appPreferences.autoArchive = autoArchiveEl ? autoArchiveEl.checked : true;
    appPreferences.model = modelEl ? modelEl.value : 'llama-3.3-70b-versatile';
    appPreferences.customInstructions = customInstructionsEl ? customInstructionsEl.value.trim() : '';

    localStorage.setItem('app_prefs', JSON.stringify(appPreferences));
}

function clearAllAppHistory() {
    if (confirm("Are you sure you want to clear all history? This will delete all chat threads and saved searches.")) {
        localStorage.removeItem('career_chats');
        localStorage.removeItem('mentor_history');
        localStorage.removeItem('course_history');
        
        chatSessions = [];
        mentorSessions = [];
        courseSessions = [];
        
        closeSettingsModal();
        location.reload();
    }
}

function handleLogout() {
    alert('Logging out...');
    localStorage.clear();
    location.reload();
}

/* ==========================================================================
   UTILITY & MARKDOWN FORMATTER
   ========================================================================== */

function formatMarkdownToHTML(text) {
    if (!text) return "";

    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/^### (.*$)/gim, '<h3 class="font-bold text-sm text-[#1A3330] mt-3 mb-1">$1</h3>')
        .replace(/^## (.*$)/gim, '<h2 class="font-bold text-base text-[#1A3330] mt-4 mb-2">$1</h2>')
        .replace(/\*\*(.*?)\*\*/g, '<strong class="font-bold text-[#1A3330]">$1</strong>')
        .replace(/^\d+\.\s+(.*$)/gim, '<div class="ml-1 my-1.5 flex items-start gap-2"><span class="font-bold text-[#199A8E] shrink-0">•</span><span>$1</span></div>')
        .replace(/^\s*[\*\-]\s+(.*$)/gim, '<div class="ml-1 my-1.5 flex items-start gap-2"><span class="font-bold text-[#199A8E] shrink-0">•</span><span>$1</span></div>')
        .replace(/\n\n/g, '<br/><br/>')
        .replace(/\n/g, '<br/>');
}

function initTypingEffect() {
    const words = ["careers", "roadmaps", "strategies", "skills"];
    let wordIndex = 0;
    let charIndex = 0;
    let isDeleting = false;
    const targetEl = document.getElementById('dynamic-typing');

    function typeEffect() {
        if (!targetEl) return;
        const currentWord = words[wordIndex];
        charIndex = isDeleting ? charIndex - 1 : charIndex + 1;

        targetEl.innerText = currentWord.substring(0, charIndex);

        let typingSpeed = isDeleting ? 60 : 120;

        if (!isDeleting && charIndex === currentWord.length) {
            typingSpeed = 2000; 
            isDeleting = true;
        } else if (isDeleting && charIndex === 0) {
            isDeleting = false;
            wordIndex = (wordIndex + 1) % words.length;
            typingSpeed = 500;
        }

        setTimeout(typeEffect, typingSpeed);
    }
    typeEffect();
}