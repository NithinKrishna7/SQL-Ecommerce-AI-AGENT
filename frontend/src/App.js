import React, { useState, useRef, useEffect } from "react";
import "./App.css";
import { fetchEventSource } from '@microsoft/fetch-event-source';
import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const TypingEffect = ({ text, speed = 50 }) => {
  const [displayText, setDisplayText] = useState("");
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    if (currentIndex < text.length) {
      const timeout = setTimeout(() => {
        setDisplayText(prev => prev + text[currentIndex]);
        setCurrentIndex(prev => prev + 1);
      }, speed);
      return () => clearTimeout(timeout);
    }
  }, [currentIndex, text, speed]);

  return <span>{displayText}</span>;
};

const ChatMessage = ({ message, isUser, isStreaming }) => {
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4`}>
      <div
        className={`max-w-3xl px-4 py-3 rounded-lg ${
          isUser
            ? 'bg-blue-600 text-white ml-4'
            : 'bg-gray-100 text-gray-800 mr-4 border'
        }`}
      >
        {isStreaming ? (
          <TypingEffect text={message} speed={50} />
        ) : (
          <div className="whitespace-pre-wrap">{message}</div>
        )}
      </div>
    </div>
  );
};

const ChartRenderer = ({ chartData }) => {
  if (!chartData) return null;

  return (
    <div className="mt-4 p-4 bg-white rounded-lg border">
      <h3 className="text-lg font-semibold mb-3">Data Visualization</h3>
      <img 
        src={chartData} 
        alt="Generated Chart" 
        className="w-full h-auto rounded-lg shadow-sm"
      />
    </div>
  );
};

const DataTable = ({ data }) => {
  if (!data || data.length === 0) return null;

  const columns = Object.keys(data[0]);

  return (
    <div className="mt-4 p-4 bg-white rounded-lg border overflow-x-auto">
      <h3 className="text-lg font-semibold mb-3">Query Results</h3>
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            {columns.map((column) => (
              <th
                key={column}
                className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {data.slice(0, 10).map((row, index) => (
            <tr key={index}>
              {columns.map((column) => (
                <td key={column} className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  {row[column]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {data.length > 10 && (
        <p className="text-sm text-gray-500 mt-2">
          Showing first 10 of {data.length} results
        </p>
      )}
    </div>
  );
};

function App() {
  const [messages, setMessages] = useState([
    {
      id: 1,
      text: "Hello! I'm your AI SQL Assistant. Ask me anything about your sales data using natural language. For example:\n\n• 'What is the total ad spend for eligible products?'\n• 'Show me products with highest revenue'\n• 'Which product had the lowest cost per click?'",
      isUser: false,
      isStreaming: false
    }
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [currentStreamingMessage, setCurrentStreamingMessage] = useState("");
  const [sqlQuery, setSqlQuery] = useState("");
  const [tableData, setTableData] = useState([]);
  const [chartData, setChartData] = useState(null);
  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, currentStreamingMessage]);

  const handleStreamingSubmit = async (e) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage = {
      id: Date.now(),
      text: input,
      isUser: true,
      isStreaming: false
    };

    setMessages(prev => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);
    setCurrentStreamingMessage("");
    setSqlQuery("");
    setTableData([]);
    setChartData(null);

    try {
      let fullResponse = "";
      
      await fetchEventSource(`${API}/ask-question`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ question: input }),
        onmessage(event) {
          const data = JSON.parse(event.data);
          
          if (data.type === 'token') {
            fullResponse += data.content;
            setCurrentStreamingMessage(fullResponse);
          } else if (data.type === 'complete') {
            setSqlQuery(data.sql_query);
            setTableData(data.table_data);
            
            const aiMessage = {
              id: Date.now() + 1,
              text: fullResponse,
              isUser: false,
              isStreaming: false
            };
            
            setMessages(prev => [...prev, aiMessage]);
            setCurrentStreamingMessage("");
          } else if (data.type === 'error') {
            const errorMessage = {
              id: Date.now() + 1,
              text: data.content,
              isUser: false,
              isStreaming: false
            };
            
            setMessages(prev => [...prev, errorMessage]);
            setCurrentStreamingMessage("");
          }
        },
        onerror(err) {
          console.error('Streaming error:', err);
          const errorMessage = {
            id: Date.now() + 1,
            text: "Sorry, I encountered an error processing your request. Please try again.",
            isUser: false,
            isStreaming: false
          };
          
          setMessages(prev => [...prev, errorMessage]);
          setCurrentStreamingMessage("");
        }
      });
    } catch (error) {
      console.error('Error:', error);
      const errorMessage = {
        id: Date.now() + 1,
        text: "Sorry, I encountered an error processing your request. Please try again.",
        isUser: false,
        isStreaming: false
      };
      
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleChartSubmit = async (e) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage = {
      id: Date.now(),
      text: input,
      isUser: true,
      isStreaming: false
    };

    setMessages(prev => [...prev, userMessage]);
    const question = input;
    setInput("");
    setIsLoading(true);
    setSqlQuery("");
    setTableData([]);
    setChartData(null);

    try {
      const response = await axios.post(`${API}/ask-with-chart`, { question });
      const { answer, sql_query, table_data, chart_base64 } = response.data;
      
      const aiMessage = {
        id: Date.now() + 1,
        text: answer,
        isUser: false,
        isStreaming: false
      };
      
      setMessages(prev => [...prev, aiMessage]);
      setSqlQuery(sql_query);
      setTableData(table_data);
      setChartData(chart_base64);
      
    } catch (error) {
      console.error('Error:', error);
      const errorMessage = {
        id: Date.now() + 1,
        text: "Sorry, I encountered an error processing your request. Please try again.",
        isUser: false,
        isStreaming: false
      };
      
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-800 mb-2">
            🧠 AI SQL Agent
          </h1>
          <p className="text-gray-600 text-lg">
            Ask questions about your data in natural language
          </p>
        </div>

        {/* Chat Container */}
        <div className="max-w-6xl mx-auto bg-white rounded-xl shadow-lg overflow-hidden">
          {/* Messages Area */}
          <div className="h-96 overflow-y-auto p-6 bg-gray-50">
            {messages.map((message) => (
              <ChatMessage
                key={message.id}
                message={message.text}
                isUser={message.isUser}
                isStreaming={message.isStreaming}
              />
            ))}
            
            {currentStreamingMessage && (
              <ChatMessage
                message={currentStreamingMessage}
                isUser={false}
                isStreaming={true}
              />
            )}
            
            {isLoading && !currentStreamingMessage && (
              <div className="flex justify-start mb-4">
                <div className="bg-gray-100 px-4 py-3 rounded-lg mr-4 border">
                  <div className="flex items-center space-x-2">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                    <span className="text-gray-600">Thinking...</span>
                  </div>
                </div>
              </div>
            )}
            
            <div ref={messagesEndRef} />
          </div>

          {/* Input Area */}
          <div className="p-6 bg-white border-t">
            <div className="flex gap-2 mb-4">
              <form onSubmit={handleStreamingSubmit} className="flex-1 flex gap-2">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Ask me anything about your sales data..."
                  className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  disabled={isLoading}
                />
                <button
                  type="submit"
                  disabled={isLoading || !input.trim()}
                  className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Stream
                </button>
              </form>
              
              <button
                onClick={handleChartSubmit}
                disabled={isLoading || !input.trim()}
                className="px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Chart
              </button>
            </div>
            
            <div className="text-sm text-gray-500">
              <strong>Sample questions:</strong> "Show products with revenue above 20000" • "What's the average CPC?" • "Plot revenue by product"
            </div>

            {/* SQL Query Display */}
            {sqlQuery && (
              <div className="mt-4 p-3 bg-gray-100 rounded-lg">
                <h3 className="text-sm font-semibold text-gray-600 mb-1">Generated SQL:</h3>
                <code className="text-sm text-blue-600">{sqlQuery}</code>
              </div>
            )}
          </div>
        </div>

        {/* Results Area */}
        {(tableData.length > 0 || chartData) && (
          <div className="max-w-6xl mx-auto mt-6">
            <ChartRenderer chartData={chartData} />
            <DataTable data={tableData} />
          </div>
        )}
      </div>
    </div>
  );
}

export default App;