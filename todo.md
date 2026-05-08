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
