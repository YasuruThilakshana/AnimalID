import { useState } from "react";
import { apiError } from "../lib/api.js";
import { useStore } from "../lib/store";
import { Logo } from "./ui";

export default function Footer() {
  const { navigate, toast, subscribeAlerts } = useStore();
  const [email, setEmail] = useState("");

  const subscribe = async (e) => {
    e.preventDefault();
    if (!email.includes("@")) return toast("Enter a valid email to subscribe.", "warn");
    try {
      await subscribeAlerts(email);
      setEmail("");
      toast("Subscribed! You'll get alerts for your area.");
    } catch (err) {
      toast(apiError(err, "Couldn't save your subscription. Please try again."), "warn");
    }
  };

  return (
    <footer className="bg-pine-950 text-stone-300">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1.3fr_1fr_1fr_1.3fr]">
        <div>
          <Logo dark />
          <p className="mt-4 max-w-xs text-sm leading-relaxed">
            The pet identification and recovery network. One ID, four photo angles, and a community
            that helps bring every lost animal home.
          </p>
          <p className="mt-4 text-sm">
            <span className="font-semibold text-white">Lost-pet hotline:</span>{" "}
            <a href="tel:+18005550199" className="text-amber-400 hover:underline">
              1-800-555-0199
            </a>
          </p>
        </div>

        <div>
          <h3 className="text-sm font-bold tracking-wide text-white uppercase">Platform</h3>
          <ul className="mt-3 space-y-2 text-sm">
            <li>
              <button onClick={() => navigate("browse")} className="cursor-pointer hover:text-white">
                Find a pet
              </button>
            </li>
            <li>
              <button onClick={() => navigate("scan")} className="cursor-pointer hover:text-white">
                Photo scan
              </button>
            </li>
            <li>
              <button onClick={() => navigate("alerts")} className="cursor-pointer hover:text-white">
                Missing pet alerts
              </button>
            </li>
            <li>
              <button onClick={() => navigate("register")} className="cursor-pointer hover:text-white">
                Register your pet
              </button>
            </li>
            <li>
              <button onClick={() => navigate("dashboard")} className="cursor-pointer hover:text-white">
                Your dashboard
              </button>
            </li>
            <li>
              <button
                onClick={() => navigate("browse", null, { status: "lost" })}
                className="cursor-pointer hover:text-white"
              >
                Lost-pet alerts
              </button>
            </li>
          </ul>
        </div>

        <div>
          <h3 className="text-sm font-bold tracking-wide text-white uppercase">Resources</h3>
          <ul className="mt-3 space-y-2 text-sm">
            <li className="hover:text-white">Tagging guide</li>
            <li className="hover:text-white">What to do if you find a pet</li>
            <li className="hover:text-white">Shelter partners</li>
            <li className="hover:text-white">Recovery stories</li>
          </ul>
        </div>

        <div>
          <h3 className="text-sm font-bold tracking-wide text-white uppercase">
            Lost-pet alerts near you
          </h3>
          <p className="mt-3 text-sm">Get a text when a pet goes missing within 10 miles.</p>
          <form className="mt-3 flex gap-2" onSubmit={subscribe}>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="min-w-0 flex-1 rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-white placeholder:text-stone-400 focus:border-amber-400 focus:outline-none"
              aria-label="Email for alerts"
            />
            <button
              type="submit"
              className="cursor-pointer rounded-lg bg-ember-500 px-4 py-2 text-sm font-semibold text-white hover:bg-ember-600"
            >
              Join
            </button>
          </form>
        </div>
      </div>
      <div className="border-t border-white/10">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 px-4 py-5 text-xs text-stone-400 sm:flex-row sm:px-6">
          <span>© 2026 AnimalID. Live registry backed by MySQL.</span>
          <span>Every registration funds shelter tagging.</span>
        </div>
      </div>
    </footer>
  );
}
