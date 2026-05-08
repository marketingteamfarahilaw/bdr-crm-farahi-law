CREATE TABLE `facility_referrals` (
	`id` int AUTO_INCREMENT NOT NULL,
	`facilityId` int NOT NULL,
	`referralDate` timestamp NOT NULL,
	`clientName` varchar(255) NOT NULL,
	`caseValue` enum('rank_x','high','medium','low','na') NOT NULL DEFAULT 'medium',
	`repId` int,
	`repName` varchar(255),
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `facility_referrals_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `ringcentral_tokens` (
	`id` int AUTO_INCREMENT NOT NULL,
	`accountId` varchar(128) NOT NULL,
	`accessToken` text NOT NULL,
	`refreshToken` text NOT NULL,
	`tokenExpiry` timestamp NOT NULL,
	`ownerExtensionId` varchar(64),
	`ownerName` varchar(255),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `ringcentral_tokens_id` PRIMARY KEY(`id`),
	CONSTRAINT `ringcentral_tokens_accountId_unique` UNIQUE(`accountId`)
);
--> statement-breakpoint
ALTER TABLE `facilities` MODIFY COLUMN `relationshipStatus` enum('active_partner','warm_lead','cold','churned','do_not_contact','needs_agent') NOT NULL DEFAULT 'warm_lead';--> statement-breakpoint
ALTER TABLE `contact_logs` ADD `callResult` enum('connected','voicemail','no_answer','busy','other');--> statement-breakpoint
ALTER TABLE `contact_logs` ADD `callDuration` varchar(20);--> statement-breakpoint
ALTER TABLE `contact_logs` ADD `callType` enum('partner_checkin','bdr_checkin','fr_checkin','internal','potential_lead','other');--> statement-breakpoint
ALTER TABLE `contact_logs` ADD `fieldHours` varchar(20);--> statement-breakpoint
ALTER TABLE `facilities` ADD `city` varchar(255);--> statement-breakpoint
ALTER TABLE `facilities` ADD `phone2` varchar(50);--> statement-breakpoint
ALTER TABLE `facilities` ADD `phone3` varchar(50);