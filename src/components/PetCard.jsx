import { petDisplayId, petPhoto, useStore } from "../lib/store";
import { PetAvatar, StatusPill } from "./ui";

export default function PetCard({ pet }) {
  const { navigate } = useStore();
  const front = petPhoto(pet);

  return (
    <button
      onClick={() => navigate("pet", pet.id)}
      className="group w-full cursor-pointer overflow-hidden rounded-2xl border border-stone-200 bg-white text-left shadow-sm transition-shadow hover:shadow-md"
    >
      {front ? (
        <img src={front} alt={`${pet.name}`} className="h-44 w-full object-cover" />
      ) : (
        <PetAvatar pet={pet} className="h-44 w-full" />
      )}
      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="font-display text-lg leading-tight font-bold text-pine-950 group-hover:underline">
              {pet.name}
            </h3>
            <p className="mt-0.5 text-xs font-medium text-stone-500">
              {pet.breed} · {pet.location}
            </p>
          </div>
          <StatusPill status={pet.status} />
        </div>
        <div className="mt-3 flex items-center justify-between border-t border-stone-100 pt-3 text-xs font-semibold text-stone-500">
          <span className="rounded-md bg-stone-100 px-2 py-1 font-mono">{petDisplayId(pet)}</span>
          <span className="text-pine-800">View profile →</span>
        </div>
      </div>
    </button>
  );
}
