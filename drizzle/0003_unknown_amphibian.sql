CREATE TABLE `contact_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`facilityId` int NOT NULL,
	`contactType` enum('call','visit','email','text','meeting','other') NOT NULL DEFAULT 'call',
	`contactDate` timestamp NOT NULL,
	`summary` text,
	`repId` int,
	`repName` varchar(255),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `contact_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `facilities` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`category` varchar(100) NOT NULL,
	`address` text,
	`phone` varchar(50),
	`website` varchar(500),
	`contactName` varchar(255),
	`contactTitle` varchar(255),
	`contactPhone` varchar(50),
	`contactEmail` varchar(320),
	`relationshipStatus` enum('active_partner','warm_lead','cold','churned','do_not_contact') NOT NULL DEFAULT 'warm_lead',
	`assignedRepId` int,
	`assignedRepName` varchar(255),
	`placeId` varchar(255),
	`latitude` float,
	`longitude` float,
	`managementFlag` int NOT NULL DEFAULT 0,
	`managementNote` text,
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `facilities_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `facility_leads_sent` (
	`id` int AUTO_INCREMENT NOT NULL,
	`facilityId` int NOT NULL,
	`year` int NOT NULL,
	`month` int NOT NULL,
	`count` int NOT NULL DEFAULT 0,
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `facility_leads_sent_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `facility_tasks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`facilityId` int NOT NULL,
	`title` varchar(500) NOT NULL,
	`description` text,
	`dueDate` timestamp,
	`assignedToId` int,
	`assignedToName` varchar(255),
	`status` enum('open','completed') NOT NULL DEFAULT 'open',
	`priority` enum('high','medium','low') NOT NULL DEFAULT 'medium',
	`completedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `facility_tasks_id` PRIMARY KEY(`id`)
);
