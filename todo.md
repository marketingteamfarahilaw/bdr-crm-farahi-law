# Farahi Lead Scraper - Project TODO

## Database & Schema
- [x] leads table (scraped lead data with scoring)
- [x] saved_leads table (bookmarked leads with annotations)
- [x] saved_searches table (saved search queries)

## Backend API
- [x] Google Maps Places API search procedure
- [x] Yelp Fusion API removed (Google Maps only)
- [x] Lead qualification scoring engine (rating 30%, reviews 30%, proximity 20%, category 20%)
- [x] Hot/Warm/Cold tier labeling
- [x] Save lead procedure
- [x] Unsave/delete saved lead procedure
- [x] Annotate saved lead procedure
- [x] Save search procedure
- [x] Delete saved search procedure
- [x] Re-run saved search procedure
- [x] Get saved leads list procedure
- [x] Get saved searches list procedure

## Frontend - Dashboard Layout
- [x] Sidebar navigation (Search, Saved Leads, Saved Searches)
- [x] Farahi Law Firm branding in sidebar
- [x] Auth protection (redirect to login if not authenticated)
- [x] User profile in sidebar footer

## Frontend - Search Page
- [x] Category selector (body shops, chiropractors, physical therapists, medical clinics, orthopedic doctors, imaging centers)
- [x] City/zip code input
- [x] Source selector (Google Maps only)
- [x] Radius selector
- [x] Search button with loading state
- [x] Save search option

## Frontend - Results Dashboard
- [x] Sortable/filterable results table
- [x] Lead score badge (0-100) with Hot/Warm/Cold tier color coding
- [x] Quick-save button per lead row
- [x] Source indicator (Google Maps)
- [x] CSV export button

## Frontend - Lead Detail View
- [x] Full business info panel
- [x] Score breakdown visualization (4 components)
- [x] Save/unsave button
- [x] Annotation field
- [x] Map embed showing business location (via Google Maps link)

## Frontend - Saved Leads Page
- [x] List of bookmarked leads
- [x] Annotation display and edit
- [x] Remove from saved
- [x] Export saved leads to CSV

## Frontend - Saved Searches Page
- [x] List of saved searches
- [x] Re-run search button
- [x] Delete saved search

## Polish & Testing
- [x] Elegant dark-accented color palette (deep navy + champagne gold)
- [x] Refined typography and spacing (Inter + Playfair Display)
- [x] Loading skeletons
- [x] Empty states
- [x] Error handling
- [x] Vitest unit tests for scoring engine (11 tests passing)
- [x] Vitest unit tests for auth logout (1 test passing)

## Remaining Fixes
- [x] Leads are ephemeral (search results not persisted — only saved_leads persists to DB, by design)
- [x] Fix re-run search: Search.tsx reads sessionStorage rerunSearch on mount and pre-fills form
- [x] Add Google Maps deep link in LeadDetailSheet for location view
- [x] Add source badge column in results table (Google Maps label)

## Bug Fixes
- [x] Replace plain text location input with Google Maps Places Autocomplete
- [x] Pass lat/lng from autocomplete directly to backend (bypass geocoding)
- [x] Update backend googleMaps.ts to accept lat/lng instead of geocoding text
- [x] Update tRPC router schema to accept optional lat/lng fields

## API Migration
- [x] Migrate backend from legacy Places API (Text Search) to Places API (New) — uses https://places.googleapis.com/v1/places:searchText
- [x] Update place details fetch to use Places API (New) — phone/website now returned inline from searchText, no separate detail call needed
- [x] Geocoding API still valid and used as fallback; primary path uses lat/lng from autocomplete

## Facility Partner CRM Module

### Database Schema
- [x] facilities table (profile, contact info, assigned rep, status, management flag)
- [x] contact_logs table (date, type, notes, rep, facility_id)
- [x] facility_tasks table (due date, assigned to, description, status, facility_id)
- [x] facility_leads_sent table (month, year, count, facility_id)

### Backend Procedures
- [x] facilities.list (with filters: status, category, search, sort)
- [x] facilities.get (single facility with all relations)
- [x] facilities.create
- [x] facilities.update
- [x] facilities.delete
- [x] facilities.promoteFromScraper (create from a scraped lead)
- [x] contactLogs.list (by facility)
- [x] contactLogs.create
- [x] contactLogs.delete
- [x] tasks.list (by facility or by current user)
- [x] tasks.create
- [x] tasks.complete
- [x] tasks.delete
- [x] leadsSent.upsert (monthly count per facility)
- [x] leadsSent.list (by facility)
- [x] management.dashboard (admin only: all facilities, overdue tasks, top referrers)

### Frontend Pages
- [x] /crm/facilities — Facility list page with search, filter, sort
- [x] /crm/facilities/:id — Facility profile page (all data on one screen)
- [x] /crm/facilities/new — Add facility form
- [x] /crm/facilities/:id/edit — Edit facility form
- [x] /crm/dashboard — Management Dashboard (admin only)
- [x] RingCentral OAuth connect/disconnect + call sync per facility
- [x] Promote-to-CRM button in Lead Scraper results table
- [x] Update sidebar navigation with CRM section (Lead Scraper + Facility Partner CRM)

## CRM Gaps to Address
- [ ] Add referrals list to facilities.get response
- [ ] Add sort controls to /crm/facilities list page
- [ ] Build RingCentral settings/connect UI in Facility Profile

## UI Fixes (Round 3)
- [x] Fix autocomplete location input freezing after one character typed
- [x] Change Facilities page from tile/card view to sortable list/table view
- [x] Add bulk import of facilities into the CRM (CSV upload, paste, and downloadable template)

## Future Enhancements
- [ ] Add multi-select checkboxes to search results table for bulk Promote to CRM action

## CRM V3 Upgrade (Facility Partner Tracker Brief)

### Schema Changes
- [ ] Update facilities table: add partnerStatus, relationshipStrength, preferredContactMethod, serviceArea, followUpWindowDays, priorityPartner, phone3, city, zipCode, lastSignedCaseDate, totalSignedCases, totalLeadsSent, totalLeadsReceived, moneyInvested, lastPackageDate
- [ ] Create facility_leads table: date, direction (sent/received), method, contactPerson, clientArea, caseStatus/outcome, notes, facilityId, signedCase boolean
- [ ] Create facility_gratitude table: date, actionType, notes, amount, facilityId, repName
- [ ] Create facility_updates table: date, rawText (transcript/note), summary, repName, facilityId, extractedData JSON
- [ ] Update facility_tasks: add followUpReason field

### Backend Procedures
- [ ] facilities.list: add partnerStatus, relationshipStrength, followUpDue filters
- [ ] facilities.getMapData: return all facilities with lat/lng, status, category for map pins
- [ ] leads.create / leads.list / leads.update (outcome)
- [ ] gratitude.create / gratitude.list
- [ ] updates.create (transcript/note drop-in with AI summary extraction)
- [ ] updates.list
- [ ] dashboard.stats: signed cases, leads sent/received, overdue follow-ups, coverage gaps
- [ ] dashboard.followUpDue: facilities with follow-up due in next N days
- [ ] dashboard.relationshipBalance: sent vs received per facility
- [ ] dashboard.coverageGap: zip codes / areas with no partner coverage

### Frontend Pages
- [ ] Map-first CRM dashboard: color-coded pins (chiro=blue, body shop=orange), left sidebar list, quick-view drawer on pin/name click
- [ ] Facility profile: summary card at top, expandable sections (contact log, leads, signed cases, follow-up, gratitude, updates/transcripts)
- [ ] Lead entry form: direction, method, clientArea, outcome, signedCase, notes
- [ ] Transcript/note drop-in: paste text, AI extracts summary + key fields, user can edit before saving
- [ ] Follow-Up dashboard view: overdue + due in 5-15 days, follow-up reason selector
- [ ] Partner Performance view: table sorted by signed cases, leads sent, leads received, conversion rate
- [ ] Relationship Balance view: sent vs received per facility, low-reciprocity flagging
- [ ] Coverage Gap view: map areas with no chiro or body shop partner
- [ ] Gratitude/relationship action log per facility
- [ ] Activity Timeline: all updates, calls, leads, gratitude by date

### Spreadsheet Column Alignment
- [ ] Agent field (assigned BD rep) — already exists as assignedRepName
- [ ] Type (Chiropractic / Body Shop) — already exists as category
- [ ] Clean Phone, Phone 2, Phone 3 — add phone3 column
- [ ] Email Address — already exists as contactEmail
- [ ] Notes (facility notes) — already exists
- [ ] Last partner in FLF — add lastPartnerInFLF field
- [ ] Status dropdown: Partner, Prospect, Dormant, Do Not Use, Priority Partner, Needs Follow-Up
- [ ] Total calls — computed from contact_logs count
- [ ] Last check in — computed from last contact log date
- [ ] Money invested — add moneyInvested field (sum of gratitude amounts)
- [ ] Last package requested — add lastPackageDate field
- [ ] Leads received — computed from facility_leads direction=received count
- [ ] Zip code — add zipCode field

## Map View for Facilities Page
- [ ] Add lat/lng columns to facilities table in schema
- [ ] Migrate DB with new lat/lng columns
- [ ] Update facilities.list backend to return lat/lng
- [ ] Update FacilityForm to geocode address and save lat/lng on create/update
- [ ] Build FacilitiesMap component with Google Maps, color-coded pins by status
- [ ] Info window on pin click: name, status, assigned rep, last contact, open profile button
- [ ] Add List/Map view toggle to Facilities page header
- [ ] Map shows all facilities with coordinates; facilities without coordinates show a warning count
- [ ] Color legend on map: Active Partner (gold), Warm Lead (amber), Cold (blue), Churned (gray), Do Not Contact (red)

## Map View Completion Status
- [x] lat/lng columns already exist in facilities schema (from V3 migration)
- [x] facilities.mapData tRPC procedure returns all facilities with coordinates
- [x] FacilitiesMap component built with color-coded AdvancedMarkerElement pins
- [x] Pin colors: Active Partner=gold, Warm Lead=amber, Cold=blue, Churned=grey, Do Not Contact=red, Needs Agent=purple
- [x] Category emoji on each pin: Body Shop=🔧, Chiro=🦴, PT=💪, Medical=🏥, Ortho=🩺, Imaging=📷
- [x] Info window on pin click: name, category, contact, BD rep, last contact, leads received, signed cases, View Profile button
- [x] Status legend overlay on map
- [x] Mapped count badge + missing-location warning overlay
- [x] Empty state when no facilities have coordinates
- [x] List/Map toggle buttons added to Facilities page header
- [x] PlacesAutocomplete migrated to use loading=async (fixes Google Maps deprecation warning)
- [x] CSS @import ordering warning fixed

## Map Filter Dropdowns
- [ ] Add Category filter dropdown to map view (All Categories + each facility type)
- [ ] Add Relationship Status filter dropdown to map view (All Statuses + each status)
- [ ] Pins update in real time when filters change
- [ ] Active filter count badge on filter controls
- [ ] Clear filters button when any filter is active
- [ ] Pin count updates to show filtered/total

## RingCentral In-App Calling & Transcription
- [ ] Research RingCentral Embeddable WebPhone SDK (ringcentral-embeddable)
- [ ] Build RingCentral OAuth connect flow (Client ID + Secret → access/refresh tokens)
- [ ] Store RingCentral tokens securely per user in ringcentral_tokens table
- [ ] Embed RingCentral WebPhone widget in the app shell (persistent, collapsible)
- [ ] Click-to-call button on every facility phone number
- [ ] Auto-populate dialer with facility phone when click-to-call triggered
- [ ] Call recording: retrieve recording URL from RingCentral API after call ends
- [ ] Auto-transcription: send recording to Whisper API, get transcript text
- [ ] Auto-save transcript to facility Updates tab with call metadata (date, duration, rep, phone)
- [ ] Auto-create Contact Log entry when call completes (direction, duration, result)
- [ ] RingCentral Settings page: connect/disconnect account, show connected user info
- [ ] Call history sync: pull recent calls from RingCentral and match to facilities by phone number

## Bug Fixes (May 2026)
- [x] Fix Places Autocomplete "Cannot read properties of undefined (reading 'Autocomplete')" — use callback-based Maps loading to ensure places library is ready before init
- [x] Unify Map.tsx and PlacesAutocomplete.tsx to share a single Maps script load via window._mapsScriptLoading promise

## RingCentral Embeddable Widget (In-App Calling)
- [x] Embed RingCentral Embeddable iframe widget (floating phone panel) using VITE_RINGCENTRAL_CLIENT_ID
- [x] Click-to-call: postMessage to widget to dial a phone number from facility profile
- [x] Listen for call-end events from widget via window.addEventListener('message')
- [x] On call end: auto-create contact log entry (date, duration, result, phone, facility)
- [x] On call end: retrieve recording URL from RingCentral API and run Whisper transcription
- [x] Save transcript to facility_updates table with call metadata
- [x] Add "Phone" button in sidebar/header to toggle widget visibility
- [x] JWT-based connect flow: store JWT in ringcentral_tokens table via new procedure

## BDR Reports Dashboard (Excel-based)
- [x] Add BDR Reports page to sidebar navigation
- [x] Call Activity report: total calls per agent per month (from contact_logs)
- [x] Partner Check-In report: facilities checked in vs. target per agent
- [x] Hashtag category breakdown: #BDRpartnercheckin, #FRpartnercheckin, #PotentialLeadSource counts
- [x] Active Partners table: agent, type, facility name, contact, status, total calls, last check-in

## Agent Management (May 2026)
- [x] Extend agent_zones table with full profile fields: firstName, lastName, employer, phone, email, title, notes, active
- [x] Add agentZones.create tRPC procedure
- [x] Add agentZones.update tRPC procedure
- [x] Add agentZones.delete tRPC procedure
- [x] Build /agents page with create/edit/delete UI, color picker, status toggle, territory cities display
- [x] Add "Team & Integrations" section to sidebar with Agents, PI Clients, Filevine nav items
- [x] Vitest tests for agent CRUD DB helpers (13 tests passing)

## PI Clients (May 2026)
- [x] Create pi_clients table (identity, incident, case status, location, Filevine IDs, agent assignment)
- [x] Add piClients.list/create/update/delete tRPC procedures
- [x] Build /pi-clients page with full CRUD and case status tracking
- [x] Nearby Partners feature: click "Nearby Partners" on a PI client to see facility partners within N miles on map
- [x] Radius selector (5/10/15/25 miles) for nearby partners map
- [x] Partner list chips below map showing matched facilities

## Filevine Integration (May 2026)
- [x] Create filevine_settings table (userId, apiKey, apiSecret, orgId, baseUrl, connected, lastSyncAt)
- [x] Add filevine.getSettings / saveSettings / disconnect tRPC procedures
- [x] Build /filevine settings page with connect/disconnect UI and credential storage
- [x] API credentials stored server-side only (never exposed to frontend)

## RingCentral Click-to-Call for PI Clients (May 2026)
- [x] pi_client_call_logs table created (callId, phoneNumber, direction, result, duration, durationStr, startTime, transcript, agentName, notes)
- [x] piClients.logCall tRPC procedure (log by piClientId)
- [x] piClients.getCallLogs tRPC procedure (list logs for a client)
- [x] piClients.findByPhone tRPC procedure (phone number lookup)
- [x] piClients.logCallByPhone tRPC procedure (auto-match phone → client and log)
- [x] Global onCallEnd handler in App.tsx auto-logs to pi_client_call_logs by phone match
- [x] Toast notification: "Call logged for [Client Name]" on successful auto-log
- [x] ClickToCallButton on PI Clients page phone numbers (triggers RingCentral widget)
- [x] Call History panel inside each expanded PI client card (direction, result, duration, transcript, timestamp)
- [x] ClickToCallButton on Agents page phone numbers

## BDR Excel System Digitization (May 2026)

- [ ] Import all existing facility partners from Excel (Active partners sheet) into facilities table
- [ ] DB schema: field_visits table (agent, date, facilities visited, hours, notes)
- [ ] DB schema: fr_expenses table (month, date, agent, facility, store, reason, amount, card type)
- [ ] DB schema: bdr_expenses table (month, date, agent, facility, phone, store, reason, amount)
- [ ] DB schema: referral_rewards table (date, agent, SUD, type, facility, client, tier, amount, status, payout, check_date, coordinator, case_number, delivery_type, contact_name, email, phone, address)
- [ ] DB schema: fr_errands table (date, client, tier, task_type, agent, status, type, notes, address, month)
- [ ] DB schema: referral_friendly_facilities table (month, client, SUD, type, PD_coordinator, partner_status, facility_name, facility_owner, BDR_assigned, status, date_sent, notes)
- [ ] Agent Dashboard page with KPIs per agent: total calls, connected calls, call duration, sign-ups, visits, referrals sent/received, expenses
- [ ] Field Visits log page: create/edit/delete daily visit entries per FR agent
- [ ] FR Expenses page: log and view UberEats/supplies expenses per FR agent per facility
- [ ] BDR Expenses page: log and view UberEats/supplies expenses per BDR agent per facility
- [ ] Referral Rewards page: log client referrals with tier (Medium/High/Rank X), payout, status
- [ ] FR Errands page: log field errands per client with task type, status, address, notes
- [ ] Referral-Friendly Facility tracker: log which facility each client was referred to, status, BDR/FR assigned
- [ ] Wire all new pages into sidebar under BDR Reports section

## BDR Intelligence Module (May 2026)

### Database Schema
- [x] field_visits table (daily visit log per agent)
- [x] fr_expenses table (field rep expense log)
- [x] bdr_expenses table (BDR expense log with month/phone)
- [x] referral_rewards table (referral rewards with tier, payout, status)
- [x] fr_errands table (field errands per client)
- [x] referral_tracker table (referral-friendly tracker)

### Backend Procedures (tRPC bdr.*)
- [x] bdr.dashboardKpis — aggregate KPIs for agent dashboard
- [x] bdr.fieldVisits.list / create / update / delete
- [x] bdr.frExpenses.list / create / update / delete
- [x] bdr.bdrExpenses.list / create / update / delete
- [x] bdr.referralRewards.list / create / update / delete
- [x] bdr.frErrands.list / create / update / delete
- [x] bdr.referralTracker.list / create / update / delete

### Frontend Pages
- [x] /bdr/dashboard — Agent Dashboard with KPI cards
- [x] /bdr/field-visits — Field Visits log with summary cards
- [x] /bdr/fr-expenses — FR Expenses log with totals
- [x] /bdr/bdr-expenses — BDR Expenses log with totals
- [x] /bdr/referral-rewards — Referral Rewards with status tracking
- [x] /bdr/fr-errands — FR Errands with status tracking
- [x] /bdr/referral-tracker — Referral-Friendly Tracker

### Navigation
- [x] Add "BDR Intelligence" section to sidebar with 7 nav items
- [x] Register all 7 BDR routes in App.tsx

## BDR Filters & Role-Based Access (Jun 2026)
- [x] Add BdrFilterBar component (agent, date range, month, year, status, search)
- [x] Add filter params to all 6 BDR tRPC procedures (fieldVisits, frExpenses, bdrExpenses, frErrands, referralRewards, referralTracker)
- [x] Apply BdrFilterBar to all 6 BDR pages
- [x] Add agentName column to users table (links user to BDR data)
- [x] Pre-register 4 agent accounts (gracel, queenie, ally, miguelf @farahilaw.com)
- [x] Email-based account merge on first login (mergeUserByEmail in sdk.ts)
- [x] Role-based data isolation: agents see only their own records, admin sees all
- [x] Agent field locked (non-editable) for non-admin users in all BDR forms

## RingCentral Call Logging for Facilities
- [x] Add findFacilityByPhone helper in crmDb.ts (match phone/phone2/phone3/contactPhone)
- [x] Add logFacilityCall tRPC procedure: match facility by phone → create contact log → fetch RC recording → transcribe → AI summary → save
- [x] Remove shared JWT auto-connect from server startup (agents log in with own RC credentials)
- [x] Update App.tsx onCallEnd handler to call logFacilityCall instead of piClients.transcribeAndLog
- [x] Update RingCentralWidget: defaultCallWith=ringout (agents log in via widget UI)
- [x] Display call logs with transcript + AI summary on Facility Profile Updates tab
- [x] Update RingCentralSettings page to reflect per-agent widget login flow

## AI Summary Enhancement — Action Items & Follow-Up Tasks
- [x] Update logFacilityCall LLM prompt to return structured JSON (summary, actionItems[], followUpTasks[], contactPerson, relationshipTone, leadsDiscussed, commitmentMade)
- [x] Store structured data in existing facility_updates.extractedData JSON column (no migration needed)
- [x] Auto-create facility_tasks entries from extracted followUpTasks after each call
- [x] Update UpdatesTab UI to display action items (amber), follow-up tasks (purple), commitment (green), tone badges
- [x] Update success toast to mention action items count and tasks created
- [x] Fix widget: stop passing JWT/clientSecret to frontend (agents log in via widget OAuth)
- [x] Add postMessage to switch calling mode to RingOut after login
- [x] Add RingOut mode hint banner in widget panel

## RC Call Logging Fixes (June 2026)
- [x] Fix: Phone number logged as caller ID instead of facility number (direction-aware logic)
- [x] Fix: syncCalls 403 error handled gracefully (shows friendly message)
- [x] Fix: Use extension-level call-log API instead of account-level (ReadCallLog vs ReadCompanyCallLog)
- [x] Fix: Pass facilityId from ClickToCallButton through to logFacilityCall (prevents duplicate facility mismatch)
- [x] Fix: RC widget JWT auto-login (pass clientSecret + jwt in iframe URL params)
