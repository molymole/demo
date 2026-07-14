const requiredDocuments = [
  { type: "Payslips", minCount: 2 },
  { type: "Bank statements", minCount: 1 },
  { type: "Tax assessments", minCount: 1 },
  { type: "Property valuation", minCount: 1 },
  { type: "Identity documents", minCount: 1 },
];

const documentMatchers = [
  { type: "Payslips", pattern: /(payslip|salary|pay[-_\s]?stub)/i },
  { type: "Bank statements", pattern: /(bank|statement|transaction)/i },
  { type: "Tax assessments", pattern: /(tax|assessment|notice[-_\s]?of[-_\s]?assessment)/i },
  { type: "Property valuation", pattern: /(valuation|property|appraisal)/i },
  { type: "Identity documents", pattern: /(passport|driver|licen[cs]e|identity|id[-_\s]?doc)/i },
  { type: "Supporting evidence", pattern: /(support|evidence|contract|rental|bonus|letter)/i },
];

const form = document.getElementById("case-form");
const documentsInput = document.getElementById("documents");
const loadDemoButton = document.getElementById("load-demo");
const foundryPreview = document.getElementById("foundry-preview");
const documentList = document.getElementById("document-list");
const completenessList = document.getElementById("completeness-list");
const extractionList = document.getElementById("extraction-list");
const riskList = document.getElementById("risk-list");
const traceList = document.getElementById("trace-list");
const summary = document.getElementById("summary");
const askChatButton = document.getElementById("ask-chat");
const voiceInputButton = document.getElementById("voice-input");
const chatQuestionInput = document.getElementById("chat-question");
const chatLog = document.getElementById("chat-log");
const voiceStatus = document.getElementById("voice-status");

let latestCaseAnalysis = null;

function currency(amount) {
  if (typeof amount !== "number" || Number.isNaN(amount)) {
    return "Not available";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount);
}

function readNumber(value) {
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function classifyDocument(file) {
  const name = file.name || "Unspecified document";
  const matched = documentMatchers.find(({ pattern }) => pattern.test(name));

  return {
    fileName: name,
    fileType: file.type || "Unknown",
    sizeKb: Math.max(1, Math.round(file.size / 1024)),
    category: matched ? matched.type : "Unclassified",
  };
}

function extractValue(notes, expression) {
  const match = notes.match(expression);
  return match ? match[1].trim() : null;
}

function extractMoney(notes, expression) {
  const raw = extractValue(notes, expression);
  return raw ? Number(raw.replace(/[$,]/g, "")) : null;
}

function buildExtraction(caseData, notes) {
  const notesText = notes || "";
  const extractedApplicant = extractValue(notesText, /(?:Applicant|Borrower)\s*:\s*([^\n]+)/i);
  const extractedEmployer = extractValue(notesText, /Employer\s*:\s*([^\n]+)/i);
  const extractedId = extractValue(notesText, /\bID\s*:\s*([A-Z0-9-]+)/i);
  const extractedTaxYear = extractValue(notesText, /Tax assessment year\s*:\s*([0-9]{4})/i);
  const extractedIncome = extractMoney(notesText, /Monthly income\s*:\s*([$0-9,.\s]+)/i);
  const extractedPropertyValue = extractMoney(notesText, /Property value\s*:\s*([$0-9,.\s]+)/i);
  const extractedBalance = extractMoney(notesText, /Balance\s*:\s*([$0-9,.\s]+)/i);

  return {
    applicantName: extractedApplicant || caseData.applicantName || null,
    employer: extractedEmployer,
    idNumber: extractedId,
    taxAssessmentYear: extractedTaxYear,
    declaredMonthlyIncome: caseData.declaredIncome,
    extractedMonthlyIncome: extractedIncome,
    requestedLoanAmount: caseData.loanAmount,
    propertyValue: extractedPropertyValue,
    availableBalance: extractedBalance,
    monthlyDebtObligations: caseData.monthlyDebt,
  };
}

function buildCompleteness(documentSummary) {
  return requiredDocuments.map((requirement) => {
    const count = documentSummary.filter((document) => document.category === requirement.type).length;
    const isComplete = count >= requirement.minCount;

    return {
      ...requirement,
      count,
      isComplete,
      message: isComplete
        ? `${requirement.type}: ${count}/${requirement.minCount} received`
        : `${requirement.type}: ${count}/${requirement.minCount} received — missing ${requirement.minCount - count}`,
    };
  });
}

function buildRisks(caseData, extraction, completeness, documents) {
  const risks = [];
  const missingDocuments = completeness.filter((item) => !item.isComplete);

  if (missingDocuments.length > 0) {
    risks.push(`Incomplete pack: ${missingDocuments.map((item) => item.type).join(", ")}.`);
  }

  if (documents.some((document) => document.category === "Unclassified")) {
    risks.push("At least one document could not be classified automatically and needs manual review.");
  }

  if (
    extraction.extractedMonthlyIncome &&
    caseData.declaredIncome &&
    Math.abs(extraction.extractedMonthlyIncome - caseData.declaredIncome) / caseData.declaredIncome > 0.15
  ) {
    risks.push("Declared monthly income differs materially from extracted income evidence.");
  }

  if (caseData.loanAmount && extraction.propertyValue) {
    const loanToValue = caseData.loanAmount / extraction.propertyValue;

    if (loanToValue > 0.8) {
      risks.push(`High loan-to-value ratio detected at ${(loanToValue * 100).toFixed(1)}%.`);
    }
  }

  const incomeForDebtCheck = extraction.extractedMonthlyIncome || caseData.declaredIncome;
  if (incomeForDebtCheck && caseData.monthlyDebt) {
    const debtToIncome = caseData.monthlyDebt / incomeForDebtCheck;

    if (debtToIncome > 0.4) {
      risks.push(`Debt-to-income ratio is elevated at ${(debtToIncome * 100).toFixed(1)}%.`);
    }
  }

  if (extraction.availableBalance && caseData.loanAmount && extraction.availableBalance < caseData.loanAmount * 0.02) {
    risks.push("Available bank balance appears low for a typical deposit, fee, and reserve profile.");
  }

  if (!risks.length) {
    risks.push("No critical issues identified by the initial case intelligence pass.");
  }

  return risks;
}

function buildRuleChecks(caseData, extraction, completeness) {
  const incomeForDebtCheck = extraction.extractedMonthlyIncome || caseData.declaredIncome;
  const debtToIncome =
    incomeForDebtCheck && caseData.monthlyDebt ? Number((caseData.monthlyDebt / incomeForDebtCheck).toFixed(3)) : null;
  const loanToValue =
    caseData.loanAmount && extraction.propertyValue ? Number((caseData.loanAmount / extraction.propertyValue).toFixed(3)) : null;

  return {
    completenessStatus: completeness.every((item) => item.isComplete) ? "complete" : "missing_documents",
    underwritingPreCheck: debtToIncome !== null && debtToIncome <= 0.4 ? "pass" : "review",
    productCriteriaCheck: loanToValue !== null && loanToValue <= 0.8 ? "pass" : "review",
    debtToIncome,
    loanToValue,
  };
}

function buildTrace(caseData, documents, completeness, risks, ruleChecks) {
  return [
    {
      stage: "case_ingest",
      system: "Europace UI / upload API / demo folder",
      status: documents.length ? "completed" : "waiting",
      detail: documents.length
        ? `Received ${documents.length} document(s) for ${caseData.caseId}.`
        : "No documents uploaded yet.",
    },
    {
      stage: "document_ai",
      system: "Document Intelligence / Content Understanding",
      status: "completed",
      detail: `Classified documents and extracted core financial and identity signals.`,
    },
    {
      stage: "foundry_agent",
      system: "Foundry financing document intelligence agent",
      status: "completed",
      detail: `Generated completeness review, plausibility checks, and reviewer summary.`,
    },
    {
      stage: "business_rules",
      system: "Internal rules / validation APIs / product criteria services",
      status: "completed",
      detail: `Underwriting pre-check: ${ruleChecks.underwritingPreCheck}; product criteria: ${ruleChecks.productCriteriaCheck}.`,
    },
    {
      stage: "evaluation_observability",
      system: "Tracing / quality evaluation / human feedback",
      status: risks.some((risk) => risk.toLowerCase().includes("no critical issues")) ? "healthy" : "attention",
      detail: `Trace captured with ${risks.length} reviewer flag(s) and completeness status ${ruleChecks.completenessStatus}.`,
    },
    {
      stage: "output",
      system: "Case UI / Copilot Studio front end",
      status: "ready",
      detail: "Structured JSON and reviewer-facing decision support are ready to return to the front end.",
    },
  ];
}

function buildFoundryRequest(caseData, documents, extraction, completeness, risks, notes, ruleChecks, trace) {
  return {
    agent: "foundry-financing-document-intelligence",
    architecture: {
      ingest: "Europace UI / upload API / demo upload folder",
      documentAI: "Document Intelligence / Content Understanding",
      orchestration: "Foundry agent",
      businessRules: "Internal rules / validation / underwriting pre-check / product criteria APIs",
      observability: "Tracing / groundedness & quality evaluation / human feedback",
      output: "Case UI / Copilot Studio front end",
    },
    caseId: caseData.caseId,
    borrower: caseData.applicantName || extraction.applicantName || "Unknown applicant",
    interactionMode: caseData.contactChannel,
    tasks: ["classify_documents", "check_case_completeness", "extract_structured_fields", "flag_risks", "prepare_reviewer_summary"],
    documentPack: documents,
    reviewerInputs: {
      requestedLoanAmount: caseData.loanAmount,
      declaredMonthlyIncome: caseData.declaredIncome,
      monthlyDebtObligations: caseData.monthlyDebt,
      notes,
    },
    currentSignals: {
      extraction,
      completeness,
      ruleChecks,
      risks,
    },
    trace,
    outputContract: {
      format: "json",
      fields: ["completenessStatus", "missingDocuments", "plausibilityFlags", "reviewerNotes", "trace"],
    },
  };
}

function buildSummary(caseData, extraction, completeness, risks, documents) {
  const ready = completeness.every((item) => item.isComplete) ? "ready for review" : "requires additional documents";
  const topRisks = risks.slice(0, 3).join(" ");

  return [
    `<p><strong>Case ${caseData.caseId}</strong> for <strong>${extraction.applicantName || "Unknown applicant"}</strong> is currently <strong>${ready}</strong>.</p>`,
    `<p>The pack includes <strong>${documents.length}</strong> uploaded documents. Verified income is <strong>${currency(extraction.extractedMonthlyIncome || caseData.declaredIncome)}</strong>, requested loan amount is <strong>${currency(caseData.loanAmount)}</strong>, and property value is <strong>${currency(extraction.propertyValue)}</strong>.</p>`,
    `<p><strong>Reviewer focus:</strong> ${topRisks}</p>`,
  ].join("");
}

function renderList(list, values, formatter) {
  list.innerHTML = "";
  values.forEach((value) => {
    const item = document.createElement("li");
    item.innerHTML = formatter(value);
    list.appendChild(item);
  });
}

function renderExtraction(extraction) {
  extractionList.innerHTML = "";

  Object.entries(extraction).forEach(([key, value]) => {
    const term = document.createElement("dt");
    const description = document.createElement("dd");

    term.textContent = key.replace(/([A-Z])/g, " $1").replace(/^./, (character) => character.toUpperCase());
    description.textContent =
      typeof value === "number"
        ? key.toLowerCase().includes("amount") || key.toLowerCase().includes("income") || key.toLowerCase().includes("value") || key.toLowerCase().includes("balance") || key.toLowerCase().includes("debt")
          ? currency(value)
          : String(value)
        : value || "Not available";

    extractionList.append(term, description);
  });
}

function analyzeCase(filesOverride) {
  const files = filesOverride || Array.from(documentsInput.files || []);
  const caseData = {
    caseId: document.getElementById("case-id").value.trim() || "Unassigned",
    applicantName: document.getElementById("applicant-name").value.trim(),
    loanAmount: readNumber(document.getElementById("loan-amount").value),
    declaredIncome: readNumber(document.getElementById("declared-income").value),
    monthlyDebt: readNumber(document.getElementById("monthly-debt").value),
    contactChannel: document.getElementById("contact-channel").value,
  };
  const notes = document.getElementById("document-notes").value.trim();
  const documents = files.map(classifyDocument);
  const extraction = buildExtraction(caseData, notes);
  const completeness = buildCompleteness(documents);
  const risks = buildRisks(caseData, extraction, completeness, documents);
  const ruleChecks = buildRuleChecks(caseData, extraction, completeness);
  const trace = buildTrace(caseData, documents, completeness, risks, ruleChecks);
  const foundryRequest = buildFoundryRequest(caseData, documents, extraction, completeness, risks, notes, ruleChecks, trace);

  foundryPreview.textContent = JSON.stringify(foundryRequest, null, 2);
  renderList(
    documentList,
    documents,
    (document) =>
      `<strong>${document.fileName}</strong> — ${document.category} · ${document.fileType} · ${document.sizeKb} KB`
  );
  renderList(completenessList, completeness, (item) => item.message);
  renderExtraction(extraction);
  renderList(riskList, risks, (risk) => risk);
  renderList(traceList, trace, (step) => `<strong>${step.stage}</strong> — ${step.status}: ${step.detail}`);
  summary.innerHTML = buildSummary(caseData, extraction, completeness, risks, documents);

  latestCaseAnalysis = {
    caseData,
    documents,
    extraction,
    completeness,
    ruleChecks,
    risks,
    trace,
    foundryRequest,
    summary: summary.textContent.trim(),
  };
}

function appendChatMessage(role, message) {
  const entry = document.createElement("div");
  entry.className = "chat-entry";
  entry.innerHTML = `<strong>${role}</strong><span>${message}</span>`;
  chatLog.prepend(entry);
}

function answerQuestion(question) {
  if (!latestCaseAnalysis) {
    return "Analyze a financing case first so I can report the document pack status and risk profile.";
  }

  const normalizedQuestion = question.toLowerCase();
  const { caseData, completeness, risks, extraction, documents } = latestCaseAnalysis;
  const missing = completeness.filter((item) => !item.isComplete).map((item) => item.type);

  if (normalizedQuestion.includes("status") || normalizedQuestion.includes("complete")) {
    return missing.length
      ? `Case ${caseData.caseId} is not complete yet. Missing or insufficient documents: ${missing.join(", ")}.`
      : `Case ${caseData.caseId} is complete and ready for reviewer assessment.`;
  }

  if (normalizedQuestion.includes("risk") || normalizedQuestion.includes("flag")) {
    return risks.join(" ");
  }

  if (normalizedQuestion.includes("income")) {
    return `Declared monthly income is ${currency(caseData.declaredIncome)} and extracted evidence shows ${currency(extraction.extractedMonthlyIncome)}.`;
  }

  if (normalizedQuestion.includes("property") || normalizedQuestion.includes("valuation")) {
    return `The extracted property value for case ${caseData.caseId} is ${currency(extraction.propertyValue)}.`;
  }

  if (normalizedQuestion.includes("summary") || normalizedQuestion.includes("overview")) {
    return latestCaseAnalysis.summary;
  }

  return `Case ${caseData.caseId} has ${documents.length} uploaded documents. Ask about completeness, risks, income, property value, or summary.`;
}

function speak(text) {
  if (!("speechSynthesis" in window)) {
    return;
  }

  const utterance = new SpeechSynthesisUtterance(text);
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

function handleChatQuestion(question) {
  const trimmedQuestion = question.trim();
  if (!trimmedQuestion) {
    return;
  }

  const answer = answerQuestion(trimmedQuestion);
  appendChatMessage("Employee", trimmedQuestion);
  appendChatMessage("Assistant", answer);
  speak(answer.replace(/<[^>]*>/g, " "));
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  analyzeCase();
});

loadDemoButton.addEventListener("click", () => {
  document.getElementById("case-id").value = "CASE-2048";
  document.getElementById("applicant-name").value = "Jordan Lee";
  document.getElementById("loan-amount").value = "650000";
  document.getElementById("declared-income").value = "9500";
  document.getElementById("monthly-debt").value = "4200";
  document.getElementById("contact-channel").value = "voice";
  document.getElementById("document-notes").value = [
    "Applicant: Jordan Lee",
    "Employer: Northwind Finance",
    "Monthly income: $9200",
    "Property value: $780000",
    "Balance: $9500",
    "Tax assessment year: 2024",
    "ID: JL-93821",
  ].join("\n");

  const demoFiles = [
    { name: "jordan_payslip_may.pdf", type: "application/pdf", size: 236000 },
    { name: "jordan_payslip_june.pdf", type: "application/pdf", size: 238000 },
    { name: "jordan_bank_statement.pdf", type: "application/pdf", size: 489000 },
    { name: "jordan_tax_assessment_2024.pdf", type: "application/pdf", size: 196000 },
    { name: "property_valuation_report.pdf", type: "application/pdf", size: 514000 },
    { name: "passport_jordan_lee.png", type: "image/png", size: 124000 },
  ];

  analyzeCase(demoFiles);
});

askChatButton.addEventListener("click", () => {
  handleChatQuestion(chatQuestionInput.value);
  chatQuestionInput.value = "";
});

chatQuestionInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    askChatButton.click();
  }
});

voiceInputButton.addEventListener("click", () => {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    voiceStatus.textContent = "Voice input is not available in this browser. Use the chat field instead.";
    return;
  }

  const recognition = new SpeechRecognition();
  recognition.lang = "en-US";
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  voiceStatus.textContent = "Listening for a case status or risk question…";

  recognition.onresult = (event) => {
    const question = event.results[0][0].transcript;
    voiceStatus.textContent = `Heard: "${question}"`;
    handleChatQuestion(question);
  };

  recognition.onerror = () => {
    voiceStatus.textContent = "Voice input failed. Please try again or use typed chat.";
  };

  recognition.onend = () => {
    if (!voiceStatus.textContent.startsWith("Heard")) {
      voiceStatus.textContent = "Voice input stopped.";
    }
  };

  recognition.start();
});

foundryPreview.textContent = "Analyze a case to prepare the Foundry AI request payload.";
summary.innerHTML = "<p>No case analyzed yet.</p>";
