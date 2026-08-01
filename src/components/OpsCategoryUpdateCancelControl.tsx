"use client";

import { useEffect } from "react";

const CATEGORY_CANCEL_API = "/api/shopling-categories/cancel";
const DEFAULT_LOCAL_CATEGORY_BASE = "http://127.0.0.1:8776";
const CATEGORY_SESSION_KEY = "commerce-os:shopling-category-update:v1";
const CATEGORY_TASK_KEY = "commerce-os-work-assistant:category-update:v1";
const CATEGORY_CANCEL_GUARD_KEY =
  "commerce-os:shopling-category-update-cancel-guard:v1";
const CATEGORY_EVENT_SOURCE = "commerce-os-category-update";
const BUTTON_ID = "shopling-category-global-cancel-button";

type CategoryTask = {
  active?: boolean;
  requestId?: string;
  startedAt?: string;
  tone?: string;
  status?: string;
  mode?: string;
  localBase?: string;
};

function readJson<T>(key: string): T | null {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) || "null");
    return parsed && typeof parsed === "object" ? (parsed as T) : null;
  } catch {
    return null;
  }
}

function clearCategoryProgress(localMode = false) {
  window.localStorage.removeItem(CATEGORY_SESSION_KEY);
  window.localStorage.removeItem(CATEGORY_TASK_KEY);
  window.localStorage.removeItem(CATEGORY_CANCEL_GUARD_KEY);
  window.postMessage(
    {
      source: CATEGORY_EVENT_SOURCE,
      type: "category-update-task-changed",
      task: null,
    },
    window.location.origin,
  );
  for (const frame of document.querySelectorAll("iframe")) {
    try {
      frame.contentWindow?.postMessage(
        {
          source: "commerce-os-work-assistant",
          type: localMode
            ? "category-local-update-cancel"
            : "category-update-cancelled",
          message: "사용자가 샵플링 카테고리 업데이트를 취소했습니다.",
        },
        window.location.origin,
      );
    } catch {
      // A cross-origin iframe cannot receive the local OPS message.
    }
  }
}

async function cancelLocalCategory(
  task: CategoryTask,
  session: CategoryTask,
) {
  const localBase =
    session.localBase || task.localBase || DEFAULT_LOCAL_CATEGORY_BASE;
  const init = {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      requestId: session.requestId || task.requestId || "",
    }),
    cache: "no-store",
    targetAddressSpace: "loopback",
  } as RequestInit & { targetAddressSpace: "loopback" };
  const response = await fetch(`${localBase}/category-update/cancel`, init);
  const body = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    message?: string;
  };
  if (!response.ok || body.ok !== true) {
    throw new Error(
      body.message ||
        "로컬 카테고리 실행기에 취소 요청을 전달하지 못했습니다.",
    );
  }
  return body.message || "로컬 샵플링 카테고리 업데이트를 취소했습니다.";
}

export function OpsCategoryUpdateCancelControl() {
  useEffect(() => {
    let busy = false;

    const cancel = async (button: HTMLButtonElement) => {
      if (busy) return;
      if (
        !window.confirm(
          "현재 샵플링 카테고리 업데이트를 취소할까요?\n취소 후 업데이트 화면에서 새 작업을 다시 시작할 수 있습니다.",
        )
      ) {
        return;
      }
      const task = readJson<CategoryTask>(CATEGORY_TASK_KEY) ?? {};
      const session = readJson<CategoryTask>(CATEGORY_SESSION_KEY) ?? {};
      const localMode = task.mode === "local" || session.mode === "local";
      busy = true;
      const previous = button.textContent;
      button.disabled = true;
      button.textContent = "취소 중...";
      try {
        if (localMode) {
          const message = await cancelLocalCategory(task, session);
          clearCategoryProgress(true);
          window.alert(message);
          return;
        }

        const response = await fetch(CATEGORY_CANCEL_API, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          credentials: "same-origin",
          body: JSON.stringify({
            requestId: session.requestId || task.requestId || "",
            startedAt: session.startedAt || task.startedAt || "",
          }),
        });
        const body = (await response.json().catch(() => ({}))) as {
          ok?: boolean;
          message?: string;
          actionsUrl?: string;
        };
        if (!response.ok || body.ok !== true) {
          throw new Error(body.message || "카테고리 업데이트를 취소하지 못했습니다.");
        }
        clearCategoryProgress(false);
        window.alert(body.message || "샵플링 카테고리 업데이트를 취소했습니다.");
      } catch (error) {
        button.disabled = false;
        button.textContent = previous;
        window.alert(
          error instanceof Error
            ? error.message
            : "샵플링 카테고리 업데이트를 취소하지 못했습니다.",
        );
      } finally {
        busy = false;
      }
    };

    const decorate = () => {
      const task = readJson<CategoryTask>(CATEGORY_TASK_KEY);
      if (task?.tone === "cancelled" || task?.status === "cancelled") {
        clearCategoryProgress(task.mode === "local");
        return;
      }
      const active = task?.active === true;
      const articles = document.querySelectorAll<HTMLElement>(
        'aside[aria-label="실시간 작업 도우미"] article',
      );
      let categoryArticle: HTMLElement | null = null;
      for (const article of articles) {
        if (article.textContent?.includes("샵플링 기준정보 동기화")) {
          categoryArticle = article;
          break;
        }
      }
      const existing = document.getElementById(BUTTON_ID);
      if (!active || !categoryArticle) {
        existing?.remove();
        return;
      }
      if (existing && categoryArticle.contains(existing)) return;
      existing?.remove();

      const updateLink = Array.from(categoryArticle.querySelectorAll("a")).find(
        (link) => link.textContent?.includes("업데이트 화면"),
      );
      const actions = updateLink?.parentElement;
      if (!actions) return;

      const button = document.createElement("button");
      button.id = BUTTON_ID;
      button.type = "button";
      button.textContent = "업데이트 취소";
      button.className =
        "rounded-lg border border-rose-300 bg-rose-50 px-2.5 py-1.5 text-[11px] font-black text-rose-700 hover:bg-rose-100 disabled:cursor-wait disabled:opacity-50";
      button.addEventListener("click", () => void cancel(button));
      actions.insertBefore(button, updateLink ?? null);
    };

    const observer = new MutationObserver(decorate);
    observer.observe(document.body, { childList: true, subtree: true });
    const onStorage = (event: StorageEvent) => {
      if (event.key === CATEGORY_TASK_KEY || event.key === CATEGORY_SESSION_KEY) {
        decorate();
      }
    };
    const onMessage = (event: MessageEvent) => {
      if (
        event.origin === window.location.origin &&
        event.data?.source === CATEGORY_EVENT_SOURCE
      ) {
        decorate();
      }
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("message", onMessage);
    const timer = window.setInterval(decorate, 1_000);
    decorate();
    return () => {
      observer.disconnect();
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("message", onMessage);
      window.clearInterval(timer);
    };
  }, []);

  return null;
}
