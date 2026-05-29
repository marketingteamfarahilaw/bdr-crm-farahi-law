CREATE TABLE `bdr_expenses` (
	`id` int AUTO_INCREMENT NOT NULL,
	`month` varchar(20),
	`expenseDate` timestamp NOT NULL,
	`agentName` varchar(255) NOT NULL,
	`agentEmail` varchar(320),
	`facilityId` int,
	`facilityName` varchar(255),
	`facilityPhone` varchar(50),
	`store` varchar(255),
	`reason` varchar(500),
	`amount` decimal(10,2) NOT NULL,
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `bdr_expenses_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `field_visits` (
	`id` int AUTO_INCREMENT NOT NULL,
	`visitDate` timestamp NOT NULL,
	`agentName` varchar(255) NOT NULL,
	`agentEmail` varchar(320),
	`agentRole` enum('FR','BDR','Manager') NOT NULL DEFAULT 'FR',
	`facilitiesVisited` json NOT NULL,
	`facilityCount` int NOT NULL DEFAULT 0,
	`hoursWorked` varchar(20),
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `field_visits_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `fr_errands` (
	`id` int AUTO_INCREMENT NOT NULL,
	`errandDate` timestamp NOT NULL,
	`clientName` varchar(255) NOT NULL,
	`clientTier` enum('Medium','High','Rank X','Standard') NOT NULL DEFAULT 'Standard',
	`taskType` varchar(255) NOT NULL,
	`agentName` varchar(255),
	`agentEmail` varchar(320),
	`status` enum('Completed','Not Completed','In Progress') NOT NULL DEFAULT 'In Progress',
	`address` text,
	`notes` text,
	`completedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `fr_errands_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `fr_expenses` (
	`id` int AUTO_INCREMENT NOT NULL,
	`expenseDate` timestamp NOT NULL,
	`agentName` varchar(255) NOT NULL,
	`agentEmail` varchar(320),
	`facilityId` int,
	`facilityName` varchar(255),
	`store` varchar(255),
	`reason` varchar(500),
	`amount` decimal(10,2) NOT NULL,
	`cardType` enum('Personal','Company') NOT NULL DEFAULT 'Company',
	`receiptUrl` varchar(500),
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `fr_expenses_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `referral_rewards` (
	`id` int AUTO_INCREMENT NOT NULL,
	`agentName` varchar(255) NOT NULL,
	`agentEmail` varchar(320),
	`sud` varchar(100),
	`referralType` enum('Chiro','Body Shop','Towing','Medical','Physical Therapy','Other') NOT NULL DEFAULT 'Chiro',
	`facilityId` int,
	`facilityName` varchar(255),
	`clientName` varchar(255),
	`clientTier` enum('Medium','High','Rank X','Standard') NOT NULL DEFAULT 'Standard',
	`payoutAmount` decimal(10,2),
	`status` enum('Accepted','Pending','Denied') NOT NULL DEFAULT 'Pending',
	`caseNumber` varchar(100),
	`coordinator` varchar(255),
	`deliveryType` varchar(100),
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `referral_rewards_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `referral_tracker` (
	`id` int AUTO_INCREMENT NOT NULL,
	`month` varchar(20),
	`clientName` varchar(255) NOT NULL,
	`pdCoordinator` varchar(255),
	`partnerStatus` varchar(100),
	`facilityId` int,
	`facilityName` varchar(255),
	`facilityType` varchar(100),
	`bdrAssigned` varchar(255),
	`status` enum('Successful Sent','Demo Sent','Pending','Unsuccessful','In Progress') NOT NULL DEFAULT 'Pending',
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `referral_tracker_id` PRIMARY KEY(`id`)
);
