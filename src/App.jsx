import Assistant from "./components/Assistant";
import Footer from "./components/Footer";
import Navbar from "./components/Navbar";
import Toasts from "./components/Toasts";
import { StoreProvider, useStore } from "./lib/store";
import Alerts from "./pages/Alerts";
import Auth from "./pages/Auth";
import Browse from "./pages/Browse";
import Dashboard from "./pages/Dashboard";
import ForgotPassword from "./pages/ForgotPassword";
import Home from "./pages/Home";
import Messages from "./pages/Messages";
import PetProfile from "./pages/PetProfile";
import RegisterPet from "./pages/RegisterPet";
import ResetPassword from "./pages/ResetPassword";
import Scanner from "./pages/Scanner";
import WhyAnimalID from "./pages/WhyAnimalID";

function Routes() {
  const { route } = useStore();
  switch (route.name) {
    case "browse":
      return <Browse />;
    case "scan":
      return <Scanner />;
    case "alerts":
      return <Alerts />;
    case "auth":
      return <Auth key={route.query.mode || "up"} />;
    case "forgot-password":
      return <ForgotPassword />;
    case "reset-password":
      return <ResetPassword key={route.param || "none"} />;
    case "register":
      return <RegisterPet />;
    case "pet":
      return <PetProfile />;
    case "dashboard":
      return <Dashboard />;
    case "messages":
      return <Messages />;
    case "why":
      return <WhyAnimalID />;
    default:
      return <Home />;
  }
}

export default function App() {
  return (
    <StoreProvider>
      <div className="flex min-h-screen flex-col">
        <Navbar />
        <div className="flex-1">
          <Routes />
        </div>
        <Footer />
        <Assistant />
        <Toasts />
      </div>
    </StoreProvider>
  );
}
