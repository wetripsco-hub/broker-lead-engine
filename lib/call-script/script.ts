// The cold-call script, as data. To change what callers see, edit THIS file only; the panel
// (components/leads/call-script-panel.tsx) just renders it. Source of truth for the wording:
// doc/loadlinkers-call-script.md.
//
// Placeholders written as [Name] are filled automatically where the app knows the value
// (see lib/call-script/fill.ts); anything it does not know stays visible and highlighted.

/** say = the caller speaks; them = what the prospect says; note = instruction for the caller; goto = where to go next. */
export type LineKind = "say" | "them" | "note" | "goto"

export interface ScriptLine {
  kind: LineKind
  text: string
}

export interface ScriptItem {
  id: string
  title: string
  lines: ScriptLine[]
  /** Item can be copied as a ready-to-send message (text or email). */
  copy?: { subject?: string }
}

export interface ScriptSection {
  id: string
  title: string
  /** Short hint shown under the title ("Use instead of the normal opener when ..."). */
  hint?: string
  items: ScriptItem[]
}

export const SCRIPT_GOALS = {
  main: "Get permission to text the trial link, or book a 15-minute demo.",
  backup: "Backup goal: a free Marketplace signup.",
  rule: 'Only text after the prospect says "sure" / "okay". Pick the outcome "Trial link sent" or "Marketplace link sent" afterwards: that records the date permission was given.',
}

export const CALL_SCRIPT: ScriptSection[] = [
  {
    id: "opener",
    title: "Opener (every call)",
    items: [
      {
        id: "opener-main",
        title: "Opener",
        lines: [
          { kind: "say", text: "Hey [Name]? It's [First Name], [Full Name]. I'm looking at your FMCSA profile here, I saw your authority went active recently, and I was wondering if you could help me out for a moment?" },
          { kind: "them", text: "Sure, what's this about?" },
          { kind: "say", text: "Well, I'm not even sure if it makes sense for us to talk yet. I'm calling new brokers to see who's still running loads and rate cons on spreadsheets, because that usually costs hours every week and causes billing mistakes. Is that something you're dealing with?" },
          { kind: "goto", text: "Excel / interested: go to YES PATH. Objection: go to NO PATH." },
        ],
      },
    ],
  },
  {
    id: "yes",
    title: "Yes path",
    items: [
      {
        id: "yes-main",
        title: "They're on Excel / interested",
        lines: [
          { kind: "them", text: "Yeah, we're on Excel." },
          { kind: "say", text: "Got it. How many loads are you running a week, roughly?" },
          { kind: "note", text: "Listen. Note the number in the CRM." },
          { kind: "say", text: "Okay. We built Loadlinkers TMS for exactly that stage. Rate cons, FMCSA carrier checks and invoices in one place, and we'll import your spreadsheet for you. There's a 7-day free trial. Would you be opposed to me texting you the trial link so you can try a load or two on your own time?" },
          { kind: "them", text: "Sure." },
          { kind: "say", text: "Perfect. Is this the best number to text?" },
          { kind: "say", text: "And would you be against a quick 15-minute call on [day] at [time], so I can import a few of your loads live and show you around?" },
          { kind: "say", text: "Great, I'll text you the link right now. Talk to you [day]." },
          { kind: "note", text: 'Save the outcome "Trial link sent" (or "Demo booked") after the call.' },
        ],
      },
    ],
  },
  {
    id: "no",
    title: "No path (objections)",
    items: [
      {
        id: "no-have-tms",
        title: '"We already have a TMS."',
        lines: [
          { kind: "say", text: "Oh nice, which one are you using? … And if you could change one thing about it, what would it be?" },
          { kind: "note", text: "Pick up on their pain point." },
          { kind: "say", text: "That's actually one of the reasons we built ours. Would you be opposed to me texting you the trial link, just to compare?" },
        ],
      },
      {
        id: "no-ascend",
        title: '"We use Ascend, it\'s free."',
        lines: [
          { kind: "say", text: "Ascend is solid. Ours is built to be simpler, and we import your data for free. Would you be against taking 15 minutes to compare side by side?" },
        ],
      },
      {
        id: "no-not-interested",
        title: '"Not interested."',
        lines: [
          { kind: "say", text: "Totally fair. Just so I know, is it because you're set with a system, or it's just not the right time?" },
          { kind: "note", text: 'If "not the right time":' },
          { kind: "say", text: "Would it be okay if I check back in a month?" },
        ],
      },
      {
        id: "no-send-email",
        title: '"Send me an email."',
        lines: [
          { kind: "say", text: "Happy to. What should I put in it so it's actually useful for you, pricing or a quick video? … And would you be opposed to a quick look on [day], so it's not just another email in your inbox?" },
          { kind: "note", text: 'Then use the email template (section "Email after") and save the outcome "Email requested".' },
        ],
      },
      {
        id: "no-price",
        title: '"How much is it?"',
        lines: [
          { kind: "say", text: "It starts at $69 a month, and there's a 7-day free trial, so you can try it with real loads before paying anything." },
        ],
      },
      {
        id: "no-busy",
        title: '"I\'m busy right now."',
        lines: [
          { kind: "say", text: "No problem. When's a better time, later today or tomorrow morning?" },
          { kind: "note", text: 'Get an exact time before hanging up. Save the outcome "Callback requested".' },
        ],
      },
      {
        id: "no-final",
        title: "They still say no to the TMS",
        lines: [{ kind: "goto", text: "Go to MARKETPLACE BACKUP." }],
      },
    ],
  },
  {
    id: "marketplace",
    title: "Marketplace backup (after the TMS is rejected)",
    items: [
      {
        id: "mp-pitch",
        title: "Pitch the Marketplace",
        lines: [
          { kind: "say", text: "Totally understand. One more thing before I let you go, and this one's free. We also run the Loadlinkers Marketplace, where we personally connect brokers with freight agents and dispatchers. You post what you're looking for, and when we find a good fit, we introduce you. Would you be opposed to me texting you the link to create a free profile?" },
        ],
      },
      {
        id: "mp-how",
        title: '"How does it work?"',
        lines: [
          { kind: "say", text: "You sign up with what you need, like an agent with their own shippers, or a dispatcher. Profiles stay private until we make a match, then we introduce both sides. No cost to join." },
        ],
      },
      {
        id: "mp-final-no",
        title: "Final no",
        lines: [{ kind: "say", text: "Understood, thanks for your time [Name]. Have a good one." }],
      },
    ],
  },
  {
    id: "marketplace-first",
    title: "Marketplace-first opener",
    hint: "Use instead of the normal opener when the CRM notes show the broker is looking for agents (job post, Facebook post, etc.).",
    items: [
      {
        id: "mpf-opener",
        title: "Marketplace-first opener",
        lines: [
          { kind: "say", text: "Hey [Name]? It's [First Name], [Full Name]. I'm looking at your FMCSA profile here, and I was wondering if you could help me out for a moment?" },
          { kind: "say", text: "Well, I'm not even sure if it makes sense for us to talk yet. I'm calling new brokers to see who's looking to bring on freight agents, because finding good agents is usually the hardest part of the first year. Is that something you're working on?" },
          { kind: "goto", text: "Then pitch the Marketplace (Marketplace backup), and mention the TMS trial at the end." },
        ],
      },
    ],
  },
  {
    id: "short",
    title: "Quick version (short script)",
    hint: "For fast calls. Same flow as above, fewer words.",
    items: [
      {
        id: "short-opener",
        title: "Opener",
        lines: [
          { kind: "say", text: "Hey [Name], it's [First Name] from Loadlinkers. I'm looking at your FMCSA profile, saw your authority went active recently. Quick question: are you still running loads on spreadsheets?" },
        ],
      },
      {
        id: "short-yes",
        title: "If yes (Excel / Sheets)",
        lines: [
          { kind: "say", text: "Got it. How many loads a week?" },
          { kind: "note", text: "Listen. Note the number in the CRM." },
          { kind: "say", text: "Okay. We built Loadlinkers TMS for exactly that: rate cons, FMCSA checks, invoices in one place, and we import your spreadsheet for free. 7-day free trial. Would you be opposed to me texting you the link?" },
        ],
      },
      {
        id: "short-text-yes",
        title: "If yes to the text",
        lines: [
          { kind: "say", text: "Perfect. Best number to text?" },
          { kind: "say", text: "And would [day] at [time] work for a quick 15-minute call so I can import a few of your loads live?" },
          { kind: "note", text: 'Save the outcome "Trial link sent" (or "Demo booked") after the call.' },
        ],
      },
      {
        id: "short-tms",
        title: "If they have a TMS",
        lines: [
          { kind: "say", text: "Which one? … What's one thing about it you'd change? … That's exactly why we built ours. Would you be opposed to trying the trial?" },
        ],
      },
      {
        id: "short-ascend",
        title: "If they say Ascend",
        lines: [{ kind: "say", text: "Ascend is solid. Ours is simpler and we import your data free. 15 minutes to compare?" }],
      },
      {
        id: "short-email",
        title: 'If they say "send an email"',
        lines: [
          { kind: "say", text: "Happy to. What's more useful, pricing or a quick demo video? … And would [day] at [time] work for a quick call?" },
          { kind: "note", text: 'Save the outcome "Email requested".' },
        ],
      },
      {
        id: "short-no",
        title: "If still no",
        lines: [{ kind: "say", text: "Cool, no problem. Can I check back in a month?" }],
      },
      {
        id: "short-marketplace",
        title: "If they want the Marketplace",
        lines: [
          { kind: "say", text: "We also run the Loadlinkers Marketplace. We personally connect brokers with freight agents and dispatchers. Free to join. Would you be opposed to me texting that link too?" },
          { kind: "note", text: 'Only text after they say yes. Save the outcome "Marketplace link sent".' },
        ],
      },
    ],
  },
  {
    id: "voicemail",
    title: "Voicemail (20 seconds max)",
    items: [
      {
        id: "vm",
        title: "Voicemail",
        lines: [
          { kind: "say", text: "Hi [Name], it's [First Name] with Loadlinkers. We help new brokers get off spreadsheets, rate cons, carrier checks and invoices in one place, and we import your loads for free. I'll send you a quick email. My number is [number]. Thanks!" },
        ],
      },
    ],
  },
  {
    id: "text",
    title: "Text after permission",
    hint: "Send right after the call, only if they agreed.",
    items: [
      {
        id: "text-tms",
        title: "TMS trial",
        copy: {},
        lines: [
          { kind: "say", text: "Hi [Name], it's [First Name] from Loadlinkers, thanks for the chat. Here's your 7-day free trial: loadlinkers.co — reply here if you want me to import your spreadsheet. Reply STOP to opt out." },
        ],
      },
      {
        id: "text-mp",
        title: "Marketplace",
        copy: {},
        lines: [
          { kind: "say", text: "Hi [Name], it's [First Name] from Loadlinkers. Here's the link to create your free Marketplace profile: loadlinkers.co/marketplace — we'll reach out once we have a good match. Reply STOP to opt out." },
        ],
      },
    ],
  },
  {
    id: "email",
    title: 'Email after "send me an email"',
    items: [
      {
        id: "email-main",
        title: "Email",
        copy: { subject: "Getting your loads off spreadsheets" },
        lines: [
          {
            kind: "say",
            text:
              "Hi [Name],\n\nThanks for taking my call today. As promised, here's the short version:\n\nLoadlinkers TMS puts rate cons, FMCSA carrier checks, invoices and tracking in one place, built for new brokers. Send me your spreadsheet and we'll import your loads for you.\n\nPlans start at $69/month with a 7-day free trial: loadlinkers.co\n\nWould [day] at [time] work for a quick 15-minute look?\n\n[First Name]\nLoadlinkers\n[Phone]",
          },
        ],
      },
    ],
  },
]

export const CALLER_NOTES: string[] = [
  "Never claim data we don't have (their lanes, load postings, etc.). Only FMCSA profile info is real.",
  'Don\'t call the Marketplace a "load board": it gives introductions, not loads.',
  "Don't make claims about how many agents/dispatchers are on the Marketplace.",
  "Best calling times (US Eastern): 10–11:30am and 2–4pm. Avoid lunch.",
]

/** The guided view walks these sections, in this order, as the call progresses. */
export const GUIDED_ORDER = ["opener", "yes", "no", "marketplace", "voicemail", "short"] as const

/** Shown under the outcome menu: what to do next for each outcome (section 9 of the doc). */
export const OUTCOME_NEXT_ACTION: Record<string, string> = {
  demo_booked: "Send calendar invite + reminder text 1 hour before",
  trial_link_sent: "Follow-up call on day 2 and day 6 of the trial",
  marketplace_link_sent: "Check the signup in 2 days",
  callback: "Call at the exact time agreed",
  email_requested: "Send the email the same day, call again in 3 days",
  left_voicemail: "Try again in 2 days (max 3 voicemails)",
  not_interested: "Retry in 60 days",
  do_not_call: "Never call or text again",
  wrong_number: "Remove the number",
  no_answer: "Try again later",
}
