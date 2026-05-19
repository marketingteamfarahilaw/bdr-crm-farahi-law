CREATE TABLE `agent_zones` (
	`id` int AUTO_INCREMENT NOT NULL,
	`agentName` varchar(100) NOT NULL,
	`color` varchar(20) NOT NULL,
	`cities` json NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `agent_zones_id` PRIMARY KEY(`id`),
	CONSTRAINT `agent_zones_agentName_unique` UNIQUE(`agentName`)
);
--> statement-breakpoint
ALTER TABLE `saved_leads` ADD `assignedAgent` varchar(100);