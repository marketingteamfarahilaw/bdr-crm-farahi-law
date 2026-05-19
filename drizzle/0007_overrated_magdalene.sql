CREATE TABLE `filevine_settings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`apiKey` text,
	`apiSecret` text,
	`orgId` varchar(100),
	`baseUrl` varchar(500) DEFAULT 'https://api.filevine.io',
	`connected` boolean NOT NULL DEFAULT false,
	`lastSyncAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `filevine_settings_id` PRIMARY KEY(`id`),
	CONSTRAINT `filevine_settings_userId_unique` UNIQUE(`userId`)
);
--> statement-breakpoint
CREATE TABLE `pi_clients` (
	`id` int AUTO_INCREMENT NOT NULL,
	`firstName` varchar(100) NOT NULL,
	`lastName` varchar(100) NOT NULL,
	`phone` varchar(50),
	`email` varchar(320),
	`incidentDate` timestamp,
	`incidentType` varchar(100),
	`caseStatus` enum('intake','active','settled','closed','lost') NOT NULL DEFAULT 'intake',
	`address` text,
	`city` varchar(100),
	`zipCode` varchar(20),
	`latitude` float,
	`longitude` float,
	`filevineCaseId` varchar(100),
	`filevineProjectId` varchar(100),
	`assignedAgentId` int,
	`assignedAgentName` varchar(255),
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `pi_clients_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `agent_zones` ADD `firstName` varchar(100);--> statement-breakpoint
ALTER TABLE `agent_zones` ADD `lastName` varchar(100);--> statement-breakpoint
ALTER TABLE `agent_zones` ADD `employer` varchar(255);--> statement-breakpoint
ALTER TABLE `agent_zones` ADD `phone` varchar(50);--> statement-breakpoint
ALTER TABLE `agent_zones` ADD `email` varchar(320);--> statement-breakpoint
ALTER TABLE `agent_zones` ADD `title` varchar(255);--> statement-breakpoint
ALTER TABLE `agent_zones` ADD `notes` text;--> statement-breakpoint
ALTER TABLE `agent_zones` ADD `active` boolean DEFAULT true NOT NULL;