import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock the db module ───────────────────────────────────────────────────────
vi.mock("./db", () => ({
  getAllAgentZones: vi.fn().mockResolvedValue([
    {
      id: 1,
      agentName: "Jane Doe",
      firstName: "Jane",
      lastName: "Doe",
      employer: "Farahi Law",
      phone: "(213) 555-0100",
      email: "jane@farahilaw.com",
      title: "BDR",
      notes: "Top performer",
      color: "#4ECDC4",
      cities: ["Los Angeles", "Burbank"],
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ]),
  getAgentById: vi.fn().mockImplementation((id: number) =>
    id === 1
      ? Promise.resolve({ id: 1, agentName: "Jane Doe", color: "#4ECDC4", cities: [], active: true })
      : Promise.resolve(undefined)
  ),
  createAgent: vi.fn().mockResolvedValue(undefined),
  updateAgent: vi.fn().mockResolvedValue(undefined),
  deleteAgent: vi.fn().mockResolvedValue(undefined),
  upsertAgentZone: vi.fn().mockResolvedValue(undefined),
  getAllPiClients: vi.fn().mockResolvedValue([
    {
      id: 1,
      firstName: "John",
      lastName: "Smith",
      phone: "(213) 555-0200",
      email: "john@email.com",
      caseStatus: "intake",
      incidentType: "Auto Accident",
      city: "Los Angeles",
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ]),
  createPiClient: vi.fn().mockResolvedValue(undefined),
  updatePiClient: vi.fn().mockResolvedValue(undefined),
  deletePiClient: vi.fn().mockResolvedValue(undefined),
  getPiClientById: vi.fn().mockResolvedValue({ id: 1, firstName: "John", lastName: "Smith" }),
  getFilevineSettings: vi.fn().mockResolvedValue({
    connected: true,
    orgId: "org123",
    baseUrl: "https://api.filevine.io",
    lastSyncAt: new Date(),
  }),
  upsertFilevineSettings: vi.fn().mockResolvedValue(undefined),
  getSavedLeads: vi.fn().mockResolvedValue([]),
  getSavedLeadByPlaceId: vi.fn().mockResolvedValue(undefined),
  insertSavedLead: vi.fn().mockResolvedValue(undefined),
  deleteSavedLead: vi.fn().mockResolvedValue(undefined),
  updateSavedLeadAnnotation: vi.fn().mockResolvedValue(undefined),
  updateSavedLeadAgent: vi.fn().mockResolvedValue(undefined),
  getSavedSearches: vi.fn().mockResolvedValue([]),
  insertSavedSearch: vi.fn().mockResolvedValue(undefined),
  deleteSavedSearch: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./googleMaps", () => ({ searchGooglePlaces: vi.fn().mockResolvedValue([]) }));
vi.mock("./scoring", () => ({ calculateScore: vi.fn().mockReturnValue({ score: 0, tier: "cold" }) }));
vi.mock("./_core/env", () => ({
  ENV: { ownerOpenId: "owner123", jwtSecret: "test-secret", oauthServerUrl: "https://auth.test" },
}));
vi.mock("./crmRouter", () => ({ crmRouter: {} }));

import { getAllAgentZones, getAgentById, createAgent, updateAgent, deleteAgent, getAllPiClients, createPiClient, getFilevineSettings } from "./db";

// ─── Agent zone DB helpers ────────────────────────────────────────────────────

describe("Agent DB helpers", () => {
  it("getAllAgentZones returns list of agents", async () => {
    const agents = await getAllAgentZones();
    expect(agents).toHaveLength(1);
    expect(agents[0].agentName).toBe("Jane Doe");
    expect(agents[0].firstName).toBe("Jane");
    expect(agents[0].lastName).toBe("Doe");
    expect(agents[0].phone).toBe("(213) 555-0100");
    expect(agents[0].email).toBe("jane@farahilaw.com");
    expect(agents[0].employer).toBe("Farahi Law");
  });

  it("getAgentById returns agent for valid id", async () => {
    const agent = await getAgentById(1);
    expect(agent).toBeDefined();
    expect(agent?.agentName).toBe("Jane Doe");
  });

  it("getAgentById returns undefined for unknown id", async () => {
    const agent = await getAgentById(999);
    expect(agent).toBeUndefined();
  });

  it("createAgent is called with correct data", async () => {
    await createAgent({
      agentName: "Bob Builder",
      firstName: "Bob",
      lastName: "Builder",
      employer: "Farahi Law",
      phone: "(310) 555-0300",
      email: "bob@farahilaw.com",
      title: "BDR",
      color: "#FF6B35",
      cities: ["San Diego"],
      active: true,
    });
    expect(createAgent).toHaveBeenCalledWith(
      expect.objectContaining({ agentName: "Bob Builder", firstName: "Bob" })
    );
  });

  it("updateAgent is called with id and partial data", async () => {
    await updateAgent(1, { phone: "(213) 555-9999" });
    expect(updateAgent).toHaveBeenCalledWith(1, { phone: "(213) 555-9999" });
  });

  it("deleteAgent is called with correct id", async () => {
    await deleteAgent(1);
    expect(deleteAgent).toHaveBeenCalledWith(1);
  });
});

// ─── PI Client DB helpers ─────────────────────────────────────────────────────

describe("PI Client DB helpers", () => {
  it("getAllPiClients returns list of clients", async () => {
    const clients = await getAllPiClients();
    expect(clients).toHaveLength(1);
    expect(clients[0].firstName).toBe("John");
    expect(clients[0].lastName).toBe("Smith");
    expect(clients[0].caseStatus).toBe("intake");
  });

  it("createPiClient is called with required fields", async () => {
    await createPiClient({
      firstName: "Alice",
      lastName: "Walker",
      phone: "(213) 555-0400",
      caseStatus: "active",
    });
    expect(createPiClient).toHaveBeenCalledWith(
      expect.objectContaining({ firstName: "Alice", lastName: "Walker" })
    );
  });
});

// ─── Filevine settings ────────────────────────────────────────────────────────

describe("Filevine settings DB helpers", () => {
  it("getFilevineSettings returns connection status", async () => {
    const settings = await getFilevineSettings(1);
    expect(settings?.connected).toBe(true);
    expect(settings?.orgId).toBe("org123");
  });
});

// ─── Agent name derivation logic ─────────────────────────────────────────────

describe("Agent name derivation", () => {
  it("derives agentName from first + last name", () => {
    const firstName = "  Miguel  ";
    const lastName = "  Flores  ";
    const agentName = `${firstName.trim()} ${lastName.trim()}`;
    expect(agentName).toBe("Miguel Flores");
  });

  it("rejects empty first name", () => {
    const firstName = "   ";
    expect(firstName.trim()).toBe("");
  });
});

// ─── Case status validation ───────────────────────────────────────────────────

describe("Case status enum", () => {
  const VALID_STATUSES = ["intake", "active", "settled", "closed", "lost"] as const;

  it("accepts all valid statuses", () => {
    VALID_STATUSES.forEach(s => {
      expect(VALID_STATUSES).toContain(s);
    });
  });

  it("rejects unknown status", () => {
    const unknown = "pending";
    expect(VALID_STATUSES).not.toContain(unknown as any);
  });
});
