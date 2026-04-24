import { useEffect, useState } from "react";
import { auth, db, googleProvider } from "./firebase";
import { signInWithPopup, User, signOut, onAuthStateChanged } from "firebase/auth";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { v4 as uuidv4 } from "uuid";
import { CheckCircle2, ChevronRight, Loader2, LogOut, Package } from "lucide-react";

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [draftProject, setDraftProject] = useState<any>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // Inform the widget relay that we are ready
  useEffect(() => {
    window.parent.postMessage("inner-ready", "*");
  }, []);

  // Listen to postMessage from MCP relay
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      // Ignore if it's from ourselves just in case
      if (event.source === window) return;

      const message = event.data;
      if (!message || message.jsonrpc !== "2.0") return;

      if (message.method === "ui/notifications/tool-result") {
        const toolResult = message.params;
        if (toolResult?.structuredContent?.projectDraft) {
          setDraftProject(toolResult.structuredContent.projectDraft);
        }
      }
    };

    window.addEventListener("message", onMessage, { passive: true });
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // Set up Firebase auth listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setIsLoggingIn(false);
    });
    return unsubscribe;
  }, []);

  const handleLogin = async () => {
    try {
      setIsLoggingIn(true);
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      console.error("Login failed:", err);
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
  };

  const handleSave = async () => {
    if (!user || !draftProject) return;
    setIsSaving(true);
    try {
      const projectId = uuidv4();
      const projectData = {
        ...draftProject,
        id: projectId,
        ownerUid: user.uid,
        createdAt: Date.now(),
        lastModified: Date.now(),
        savedAt: serverTimestamp(),
      };

      await setDoc(doc(db, "users", user.uid, "projects", projectId), projectData);
      setIsSaved(true);
    } catch (err) {
      console.error("Save failed:", err);
      alert("Failed to save project. See console.");
    } finally {
      setIsSaving(false);
    }
  };

  if (!draftProject) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50 text-gray-500">
        Waiting for ChatGPT to prepare draft project...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 p-4 font-sans">
      <div className="mx-auto max-w-xl bg-white shadow-sm border border-gray-100 rounded-2xl overflow-hidden">
        {/* Header */}
        <div className="bg-indigo-600 px-6 py-5 flex items-center justify-between text-white">
          <div className="flex items-center space-x-3">
            <Package className="w-6 h-6 text-indigo-200" />
            <h1 className="text-xl font-medium tracking-tight">Draft Project</h1>
          </div>
          {user && (
            <div className="flex items-center space-x-3 text-sm">
              <span className="text-indigo-200">{user.email}</span>
              <button 
                onClick={handleLogout}
                className="p-1.5 hover:bg-white/10 rounded-lg transition-colors"
                title="Log out"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          <div className="space-y-4">
            <div>
              <h2 className="text-sm font-medium text-gray-500 mb-1 tracking-wider uppercase">Project Name</h2>
              <p className="text-lg font-medium text-gray-900">{draftProject.name}</p>
            </div>
            
            {draftProject.description && (
              <div>
                <h2 className="text-sm font-medium text-gray-500 mb-1 tracking-wider uppercase">Description</h2>
                <p className="text-gray-700 leading-relaxed text-sm">{draftProject.description}</p>
              </div>
            )}

            {draftProject.agent && (
              <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
                <h2 className="text-sm font-medium text-gray-500 mb-3 tracking-wider uppercase">Agent Configuration</h2>
                <div className="grid gap-3">
                  <div className="flex items-start">
                    <span className="w-24 shrink-0 text-sm font-medium text-gray-500">Name</span>
                    <span className="text-sm text-gray-900">{draftProject.agent.name}</span>
                  </div>
                  <div className="flex items-start">
                    <span className="w-24 shrink-0 text-sm font-medium text-gray-500">Approach</span>
                    <span className="text-sm text-gray-900">{draftProject.agent.approach}</span>
                  </div>
                  <div className="flex items-start">
                    <span className="w-24 shrink-0 text-sm font-medium text-gray-500">Expertise</span>
                    <span className="text-sm text-gray-900">{draftProject.agent.expertise}</span>
                  </div>
                </div>
              </div>
            )}

            {draftProject.suggestedTopics?.length > 0 && (
              <div>
                <h2 className="text-sm font-medium text-gray-500 mb-2 tracking-wider uppercase">Suggested Topics</h2>
                <ul className="space-y-2">
                  {draftProject.suggestedTopics.map((topic: string, i: number) => (
                    <li key={i} className="text-sm text-gray-700 flex items-start">
                      <ChevronRight className="w-4 h-4 mr-2 shrink-0 text-indigo-400 mt-0.5" />
                      <span>{topic}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="pt-6 border-t border-gray-100">
            {!user ? (
              <button
                onClick={handleLogin}
                disabled={isLoggingIn}
                className="w-full bg-white border border-gray-300 text-gray-700 font-medium py-3 px-4 rounded-xl shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 transition-all flex items-center justify-center"
              >
                {isLoggingIn ? (
                  <Loader2 className="w-5 h-5 animate-spin mx-auto text-indigo-600" />
                ) : (
                  <>
                    <svg className="w-5 h-5 mr-3" viewBox="0 0 24 24">
                      <path
                        fill="currentColor"
                        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                      />
                      <path
                        fill="#34A853"
                        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                      />
                      <path
                        fill="#FBBC05"
                        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                      />
                      <path
                        fill="#EA4335"
                        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                      />
                      <path fill="none" d="M1 1h22v22H1z" />
                    </svg>
                    Continue with Google
                  </>
                )}
              </button>
            ) : isSaved ? (
              <div className="w-full bg-green-50 border border-green-200 text-green-700 font-medium py-3 px-4 rounded-xl flex items-center justify-center">
                <CheckCircle2 className="w-5 h-5 mr-2" />
                Project Saved to FreshFront!
              </div>
            ) : (
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="w-full bg-indigo-600 text-white font-medium py-3 px-4 rounded-xl shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 transition-all flex items-center justify-center"
              >
                {isSaving ? <Loader2 className="w-5 h-5 animate-spin mx-auto text-white" /> : "Save Project"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
