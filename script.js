async function loadQuestions() {
	const response = await fetch("questions.txt");
	if (!response.ok) {
		throw new Error(`Could not load questions: ${response.status}`);
	}

	const encoded = (await response.text()).replace(/\s/g, "");
	const binary = atob(encoded);
	const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
	const questions = JSON.parse(new TextDecoder().decode(bytes));

	if (!Array.isArray(questions) || questions.length !== 3000) {
		throw new Error("The question bank must contain exactly 3000 questions.");
	}

	return questions;
}

const loadStatus = document.querySelector("#load-status");
const startButton = document.querySelector("#start-round");
const modeMenu = document.querySelector("#mode-menu");
const gamePanel = document.querySelector("#game-panel");
const modeInputs = document.querySelectorAll('input[name="mode"]');
const activeMode = document.querySelector("#active-mode");
const timerLabel = document.querySelector("#timer");
const fieldCount = document.querySelector("#field-count");
const fieldLabel = document.querySelector("#field-label");
const matchupLabel = document.querySelector("#matchup-label");
const seriesLabel = document.querySelector("#series-label");
const seriesScore = document.querySelector("#series-score");
const categoryLabel = document.querySelector("#question-category");
const questionNumber = document.querySelector("#question-number");
const questionText = document.querySelector("#question-label");
const answerForm = document.querySelector("#answer-form");
const playerAnswer = document.querySelector("#player-answer");
const feedback = document.querySelector("#feedback");
const botResponse = document.querySelector("#bot-response");
const answerText = document.querySelector("#answer-text");
const restartButton = document.querySelector("#restart-game");

const opponentNames = Array.from({ length: 11 }, (_, index) => `Mathlete ${String(index + 2).padStart(2, "0")}`);
const answerRevealDuration = 5000;

const modes = {
	hard: { name: "Hard", accuracy: 0.95, minimumDelay: 5, maximumDelay: 10, bot: true },
	normal: { name: "Normal", accuracy: 0.8, minimumDelay: 12, maximumDelay: 20, bot: true },
	easy: { name: "Easy", accuracy: 0.6, minimumDelay: 30, maximumDelay: 45, noReplyChance: 0.4, bot: true },
	zen: { name: "Zen", bot: false },
};

let currentMode;
let currentQuestion;
let timerInterval;
let botTimeout;
let advanceTimeout;
let roundEndsAt;
let roundOver = false;
let questionResolved = false;
let opponents;
let opponentIndex = 0;
let opponentsRemaining = 11;
let currentOpponent;
let playerScore = 0;
let opponentScore = 0;
let questionsInMatch = 0;
let suddenDeath = false;

function randomIndex(length) {
	const range = 0x100000000;
	const limit = Math.floor(range / length) * length;
	const values = new Uint32Array(1);
	let value;

	do {
		crypto.getRandomValues(values);
		value = values[0];
	} while (value >= limit);

	return value % length;
}

function normalizedAnswer(value) {
	return value.trim().toLowerCase().replace(/\s+/g, "").replace(/,/g, "");
}

function makeWrongAnswer(answer) {
	const fractionMatch = answer.match(/^(\d+)\/(\d+)$/);
	if (fractionMatch) {
		return `${Number(fractionMatch[1]) + 1}/${fractionMatch[2]}`;
	}

	const piMatch = answer.match(/^(\d+)pi$/i);
	if (piMatch) {
		return `${Number(piMatch[1]) + 1}pi`;
	}

	const coordinateMatch = answer.match(/^\((-?\d+),\s*(-?\d+)\)$/);
	if (coordinateMatch) {
		return `(${Number(coordinateMatch[1]) + 1}, ${coordinateMatch[2]})`;
	}

	const numericAnswer = Number(answer);
	return Number.isFinite(numericAnswer) ? String(numericAnswer + 1) : `Not ${answer}`;
}

function clearRoundTimers() {
	window.clearInterval(timerInterval);
	window.clearTimeout(botTimeout);
	window.clearTimeout(advanceTimeout);
}

function showCorrectAnswer() {
	answerText.textContent = `Correct answer: ${currentQuestion.answer}`;
	answerText.hidden = false;
}

function finishRound() {
	if (currentMode.bot && botResponse.textContent === "Bot is thinking…") {
		botResponse.textContent = `${currentOpponent} did not answer in time.`;
	}
	resolveQuestion(null, "Time expired. No point awarded.");
}

function updateTimer() {
	const secondsLeft = Math.max(0, Math.ceil((roundEndsAt - Date.now()) / 1000));
	const formattedTime = `${String(Math.floor(secondsLeft / 60)).padStart(2, "0")}:${String(secondsLeft % 60).padStart(2, "0")}`;
	if (timerLabel.textContent !== formattedTime) {
		timerLabel.textContent = formattedTime;
	}
	if (secondsLeft === 0) {
		finishRound();
	}
}

function startBot() {
	if (!currentMode.bot) {
		botResponse.hidden = true;
		return;
	}

	botResponse.hidden = false;
	botResponse.textContent = "Bot is thinking…";
	if (currentMode.noReplyChance && Math.random() < currentMode.noReplyChance) {
		return;
	}

	const delay = currentMode.minimumDelay + Math.random() * (currentMode.maximumDelay - currentMode.minimumDelay);
	botTimeout = window.setTimeout(() => {
		const isCorrect = Math.random() < currentMode.accuracy;
		const response = isCorrect ? currentQuestion.answer : makeWrongAnswer(currentQuestion.answer);
		botResponse.textContent = isCorrect
			? `${currentOpponent} answered correctly: ${response}`
			: `${currentOpponent} missed: ${response}`;
		if (isCorrect) {
			resolveQuestion("opponent", `${currentOpponent} scores a point.`);
		} else {
			feedback.textContent = `${currentOpponent} missed. No point awarded; your answer is still live.`;
		}
	}, delay * 1000);
}

function updateSeriesDisplay() {
	seriesScore.textContent = `You ${playerScore} - ${opponentScore} ${currentOpponent}`;
	seriesLabel.textContent = suddenDeath
		? `Sudden death · Question ${questionsInMatch - 2}`
		: `Best of 3 · Question ${questionsInMatch + 1} of 3`;
}

function resolveMatch(winner) {
	if (winner === "opponent") {
		roundOver = true;
		fieldCount.textContent = String(opponentsRemaining);
		fieldLabel.textContent = opponentsRemaining === 1 ? "Mathlete remains" : "Mathletes remain";
		matchupLabel.textContent = `${currentOpponent} advances`;
		feedback.textContent = `${currentOpponent} won the match. You are eliminated.`;
		restartButton.hidden = false;
		return;
	}

	opponentsRemaining -= 1;
	opponentIndex += 1;
	fieldCount.textContent = String(opponentsRemaining + 1);
	fieldLabel.textContent = opponentsRemaining === 0 ? "Mathlete remains" : "Mathletes remain";
	if (opponentsRemaining === 0) {
		roundOver = true;
		categoryLabel.textContent = "CHAMPION";
		questionNumber.textContent = "11 RIVALS ELIMINATED";
		questionText.textContent = "You are the Countdown Champion!";
		feedback.textContent = "You outlasted the entire field.";
		matchupLabel.textContent = "Champion";
		restartButton.hidden = false;
		return;
	}

	feedback.textContent = `You eliminated ${currentOpponent}. Next rival in a moment.`;
	advanceTimeout = window.setTimeout(() => {
		playerScore = 0;
		opponentScore = 0;
		questionsInMatch = 0;
		suddenDeath = false;
		nextQuestion();
	}, answerRevealDuration);
}

function resolveQuestion(pointWinner, message) {
	if (roundOver || questionResolved) {
		return;
	}
	questionResolved = true;
	clearRoundTimers();
	playerAnswer.disabled = true;
	answerForm.querySelector("button[type='submit']").disabled = true;
	showCorrectAnswer();

	if (pointWinner === "player") {
		playerScore += 1;
	} else if (pointWinner === "opponent") {
		opponentScore += 1;
	}

	questionsInMatch += 1;
	updateSeriesDisplay();
	feedback.textContent = message;

	let matchWinner = null;
	if (suddenDeath && pointWinner) {
		matchWinner = pointWinner;
	} else if (playerScore >= 2) {
		matchWinner = "player";
	} else if (opponentScore >= 2) {
		matchWinner = "opponent";
	} else if (questionsInMatch >= 3 && !suddenDeath) {
		if (playerScore > opponentScore) {
			matchWinner = "player";
		} else if (opponentScore > playerScore) {
			matchWinner = "opponent";
		} else {
			suddenDeath = true;
			updateSeriesDisplay();
			feedback.textContent = "The match is tied. Sudden death: first point wins.";
		}
	}

	if (matchWinner) {
		resolveMatch(matchWinner);
		return;
	}

	if (suddenDeath && !pointWinner) {
		feedback.textContent = "No point. Sudden death continues.";
	}
	advanceTimeout = window.setTimeout(() => {
		questionResolved = false;
		nextQuestion();
	}, answerRevealDuration);
}

function nextQuestion() {
	if (roundOver) {
		return;
	}
	clearRoundTimers();
	questionResolved = false;
	currentOpponent = opponents[opponentIndex];
	matchupLabel.textContent = `You vs. ${currentOpponent}`;
	activeMode.textContent = `${currentMode.name} mode · Match ${opponentIndex + 1} of 11`;
	updateSeriesDisplay();
	currentQuestion = window.questionBank[randomIndex(window.questionBank.length)];
	categoryLabel.textContent = currentQuestion.category;
	questionNumber.textContent = `QUESTION ${currentQuestion.id} / ${window.questionBank.length.toLocaleString()}`;
	questionText.textContent = currentQuestion.question;
	answerText.hidden = true;
	feedback.textContent = "";
	playerAnswer.value = "";
	playerAnswer.disabled = false;
	answerForm.querySelector("button[type='submit']").disabled = false;
	roundEndsAt = Date.now() + 45_000;
	updateTimer();
	timerInterval = window.setInterval(updateTimer, 200);
	startBot();
	playerAnswer.focus();
}

function shuffle(items) {
	for (let index = items.length - 1; index > 0; index -= 1) {
		const swapIndex = randomIndex(index + 1);
		[items[index], items[swapIndex]] = [items[swapIndex], items[index]];
	}
	return items;
}

function startCompetition(mode) {
	clearRoundTimers();
	currentMode = mode;
	opponents = shuffle([...opponentNames]);
	opponentIndex = 0;
	opponentsRemaining = opponentNames.length;
	roundOver = false;
	questionResolved = false;
	playerScore = 0;
	opponentScore = 0;
	questionsInMatch = 0;
	suddenDeath = false;
	fieldCount.textContent = String(opponentsRemaining + 1);
	fieldLabel.textContent = "Mathletes remain";
	restartButton.hidden = true;
	modeMenu.hidden = true;
	gamePanel.hidden = false;
	activeMode.textContent = `${currentMode.name} mode`;
	nextQuestion();
}

window.questionsReady = loadQuestions().then((questions) => {
	window.questionBank = questions;
	startButton.disabled = false;
	if (loadStatus) {
		loadStatus.textContent = `${questions.length.toLocaleString()} questions ready`;
	}
	return questions;
}).catch((error) => {
	if (loadStatus) {
		loadStatus.textContent = "The question bank could not be loaded.";
	}
	console.error(error);
	return null;
});

modeInputs.forEach((input) => {
	input.addEventListener("change", () => {
		startButton.disabled = !window.questionBank;
	});
});

startButton.addEventListener("click", () => {
	const selectedMode = document.querySelector('input[name="mode"]:checked');
	if (!selectedMode || !window.questionBank) {
		return;
	}
	startCompetition(modes[selectedMode.value]);
});

document.querySelector("#change-mode").addEventListener("click", () => {
	clearRoundTimers();
	gamePanel.hidden = true;
	modeMenu.hidden = false;
});

restartButton.addEventListener("click", () => startCompetition(currentMode));

answerForm.addEventListener("submit", (event) => {
	event.preventDefault();
	if (roundOver || questionResolved || !currentQuestion) {
		return;
	}
	const isCorrect = normalizedAnswer(playerAnswer.value) === normalizedAnswer(currentQuestion.answer);
	if (isCorrect) {
		resolveQuestion("player", "Your answer is correct. You score a point.");
	} else {
		playerAnswer.value = "";
		feedback.textContent = "Not correct. No point awarded; try again before time runs out.";
		playerAnswer.focus();
	}
});
