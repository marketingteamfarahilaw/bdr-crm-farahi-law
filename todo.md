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
