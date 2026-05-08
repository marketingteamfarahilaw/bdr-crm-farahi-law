CREATE TABLE `saved_leads` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`placeId` varchar(255) NOT NULL,
	`source` enum('google','yelp') NOT NULL,
	`name` varchar(255) NOT NULL,
	`address` text,
	`phone` varchar(50),
	`website` varchar(500),
	`email` varchar(320),
	`category` varchar(100),
	`rating` float,
	`reviewCount` int,
	`latitude` float,
	`longitude` float,
	`qualificationScore` float,
	`scoreTier` enum('hot','warm','cold'),
	`scoreBreakdown` json,
	`annotation` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `saved_leads_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `saved_searches` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`name` varchar(255) NOT NULL,
	`category` varchar(100) NOT NULL,
	`location` varchar(255) NOT NULL,
	`source` enum('google','yelp','both') NOT NULL DEFAULT 'both',
	`radiusMiles` int NOT NULL DEFAULT 10,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `saved_searches_id` PRIMARY KEY(`id`)
);
