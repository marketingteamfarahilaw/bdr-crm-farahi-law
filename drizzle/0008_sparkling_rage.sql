CREATE TABLE `pi_client_call_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`piClientId` int NOT NULL,
	`callId` varchar(255),
	`phoneNumber` varchar(50),
	`direction` varchar(20),
	`result` varchar(50),
	`duration` int,
	`durationStr` varchar(20),
	`startTime` varchar(100),
	`transcript` text,
	`agentName` varchar(255),
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `pi_client_call_logs_id` PRIMARY KEY(`id`)
);
