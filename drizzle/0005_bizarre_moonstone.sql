CREATE TABLE `facility_gratitude` (
	`id` int AUTO_INCREMENT NOT NULL,
	`facilityId` int NOT NULL,
	`actionDate` timestamp NOT NULL,
	`actionType` enum('thank_you_call','thank_you_sms','visit','meal_delivery','gift','other') NOT NULL,
	`amount` decimal(10,2),
	`notes` text,
	`repId` int,
	`repName` varchar(255),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `facility_gratitude_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `facility_leads` (
	`id` int AUTO_INCREMENT NOT NULL,
	`facilityId` int NOT NULL,
	`direction` enum('sent_to_facility','received_from_facility') NOT NULL,
	`leadDate` timestamp NOT NULL,
	`method` enum('phone_call','sms','direct_contact','email','in_person','other') NOT NULL DEFAULT 'phone_call',
	`contactPerson` varchar(255),
	`clientArea` varchar(255),
	`outcome` enum('pending','signed','not_signed','not_qualified','duplicate','unknown') NOT NULL DEFAULT 'pending',
	`signedCase` int NOT NULL DEFAULT 0,
	`signedDate` timestamp,
	`notes` text,
	`repId` int,
	`repName` varchar(255),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `facility_leads_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `facility_updates` (
	`id` int AUTO_INCREMENT NOT NULL,
	`facilityId` int NOT NULL,
	`updateDate` timestamp NOT NULL,
	`rawText` text,
	`summary` varchar(500),
	`extractedData` json,
	`updateType` enum('transcript','sms','manual_note','visit_note','other') NOT NULL DEFAULT 'manual_note',
	`repId` int,
	`repName` varchar(255),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `facility_updates_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `contact_logs` ADD `fromRingCentral` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `facilities` ADD `zipCode` varchar(20);--> statement-breakpoint
ALTER TABLE `facilities` ADD `serviceArea` varchar(255);--> statement-breakpoint
ALTER TABLE `facilities` ADD `preferredContactMethod` enum('phone','sms','email','in_person','other');--> statement-breakpoint
ALTER TABLE `facilities` ADD `partnerStatus` enum('prospect','active_partner','priority_partner','needs_follow_up','dormant','do_not_use') DEFAULT 'prospect' NOT NULL;--> statement-breakpoint
ALTER TABLE `facilities` ADD `relationshipStrength` enum('new','warm','strong','at_risk','unknown') DEFAULT 'new' NOT NULL;--> statement-breakpoint
ALTER TABLE `facilities` ADD `priorityPartner` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `facilities` ADD `followUpWindowDays` int DEFAULT 7 NOT NULL;--> statement-breakpoint
ALTER TABLE `facilities` ADD `lastContactDate` timestamp;--> statement-breakpoint
ALTER TABLE `facilities` ADD `nextFollowUpDate` timestamp;--> statement-breakpoint
ALTER TABLE `facilities` ADD `lastCheckInDate` timestamp;--> statement-breakpoint
ALTER TABLE `facilities` ADD `totalSignedCases` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `facilities` ADD `totalLeadsSent` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `facilities` ADD `totalLeadsReceived` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `facilities` ADD `totalCalls` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `facilities` ADD `lastSignedCaseDate` timestamp;--> statement-breakpoint
ALTER TABLE `facilities` ADD `moneyInvested` decimal(10,2) DEFAULT '0.00';--> statement-breakpoint
ALTER TABLE `facilities` ADD `lastPackageDate` timestamp;--> statement-breakpoint
ALTER TABLE `facilities` ADD `lastPartnerInFLF` varchar(255);--> statement-breakpoint
ALTER TABLE `facility_tasks` ADD `followUpReason` enum('thank_you','send_lead','ask_for_referral','request_update','check_relationship','reconnect','other');