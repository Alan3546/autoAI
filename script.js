const chatForm = document.getElementById("chatForm");
const userMessage = document.getElementById("userMessage");
const sendButton = document.getElementById("sendButton");
const chatMessages = document.getElementById("chatMessages");
const carsContainer = document.getElementById("carsContainer");
const resultCount = document.getElementById("resultCount");
const clearChat = document.getElementById("clearChat");

let history = [];
let currentCars = [];

function formatPrice(price) {
  return new Intl.NumberFormat("ru-RU").format(price) + " ₸";
}

function addMessage(role, text, temporary = false) {
  const wrapper = document.createElement("div");
  wrapper.className = `message ${role === "user" ? "user-message" : "assistant-message"}`;
  if (temporary) wrapper.id = "typingMessage";

  if (role === "assistant") {
    const avatar = document.createElement("div");
    avatar.className = "message-avatar";
    avatar.textContent = "✦";
    wrapper.appendChild(avatar);
  }

  const content = document.createElement("div");
  content.className = "message-content";
  content.textContent = text;
  wrapper.appendChild(content);
  chatMessages.appendChild(wrapper);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return wrapper;
}

function renderCars(cars) {
  currentCars = Array.isArray(cars) ? cars : [];
  carsContainer.innerHTML = "";
  resultCount.textContent = `${currentCars.length} ${currentCars.length === 1 ? "автомобиль" : "автомобилей"}`;

  if (!currentCars.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.innerHTML = '<div class="empty-icon">⌕</div><h3>Точных совпадений нет</h3><p>Попробуй изменить бюджет, год выпуска или тип кузова.</p>';
    carsContainer.appendChild(empty);
    return;
  }

  currentCars.forEach((car, carIndex) => {
    const card = document.createElement("article");
    card.className = "car-card";

    const gallery = document.createElement("div");
    gallery.className = "car-gallery";

    const img = document.createElement("img");
    img.src = car.images?.[0] || "";
    img.alt = `${car.brand} ${car.model}`;
    img.loading = "lazy";
    img.onerror = () => {
      img.onerror = null;
      img.src = "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="100%" height="100%" fill="#182437"/><text x="50%" y="48%" fill="#93a1b7" font-size="26" text-anchor="middle">AutoAI</text><text x="50%" y="60%" fill="#93a1b7" font-size="15" text-anchor="middle">Добавь фото в public/images</text></svg>'
      );
    };
    gallery.appendChild(img);

    const images = Array.isArray(car.images) ? car.images : [];
    let imageIndex = 0;

    if (images.length > 1) {
      const prev = document.createElement("button");
      prev.className = "gallery-btn gallery-prev";
      prev.type = "button";
      prev.textContent = "‹";
      prev.setAttribute("aria-label", "Предыдущее фото");

      const next = document.createElement("button");
      next.className = "gallery-btn gallery-next";
      next.type = "button";
      next.textContent = "›";
      next.setAttribute("aria-label", "Следующее фото");

      const counter = document.createElement("div");
      counter.className = "image-counter";
      counter.textContent = `1 / ${images.length}`;

      const moveImage = (direction) => {
        imageIndex = (imageIndex + direction + images.length) % images.length;
        img.src = images[imageIndex];
        counter.textContent = `${imageIndex + 1} / ${images.length}`;
      };

      prev.addEventListener("click", () => moveImage(-1));
      next.addEventListener("click", () => moveImage(1));
      gallery.append(prev, next, counter);
    }

    const info = document.createElement("div");
    info.className = "car-info";

    const title = document.createElement("h3");
    title.textContent = `${car.brand} ${car.model}`;

    const meta = document.createElement("div");
    meta.className = "car-meta";
    [`${car.year} год`, car.body, car.brand].forEach(value => {
      const tag = document.createElement("span");
      tag.textContent = value;
      meta.appendChild(tag);
    });

    const price = document.createElement("div");
    price.className = "car-price";
    price.textContent = formatPrice(car.price);

    info.append(title, meta, price);
    card.append(gallery, info);
    carsContainer.appendChild(card);
  });
}

async function sendMessage(text) {
  const trimmed = text.trim();
  if (!trimmed || sendButton.disabled) return;

  addMessage("user", trimmed);
  history.push({ role: "user", content: trimmed });
  userMessage.value = "";
  userMessage.style.height = "auto";
  sendButton.disabled = true;

  const typing = addMessage("assistant", "Анализирую запрос и подбираю автомобили…", true);

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: trimmed, history: history.slice(-8, -1) })
    });

    const data = await response.json();
    typing.remove();

    if (!response.ok) throw new Error(data.error || "Произошла ошибка.");

    addMessage("assistant", data.answer || "Готово. Я подобрал варианты ниже.");
    history.push({ role: "assistant", content: data.answer || "" });
    history = history.slice(-10);
    renderCars(data.cars);
  } catch (error) {
    typing.remove();
    addMessage("assistant", `Не получилось обработать запрос: ${error.message}`);
    history.pop();
  } finally {
    sendButton.disabled = false;
    userMessage.focus();
  }
}

chatForm.addEventListener("submit", event => {
  event.preventDefault();
  sendMessage(userMessage.value);
});

userMessage.addEventListener("input", () => {
  userMessage.style.height = "auto";
  userMessage.style.height = `${Math.min(userMessage.scrollHeight, 120)}px`;
});

document.querySelectorAll(".prompt-chip").forEach(button => {
  button.addEventListener("click", () => sendMessage(button.dataset.prompt || ""));
});

clearChat.addEventListener("click", () => {
  history = [];
  chatMessages.innerHTML = "";
  addMessage("assistant", "Чат очищен. Расскажи, какой автомобиль ты ищешь.");
  renderCars([]);
});

renderCars([]);
